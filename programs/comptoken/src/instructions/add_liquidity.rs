use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};
use ethnum::U256;

use crate::{
    constants::{
        COMPTOKEN_LIQUIDITY_TOKEN_ACCOUNT_SEED, COMP_USDC_POOL_ADDRESS, GLOBAL_DATA_SEED,
        LIQUIDITY_MAX_PRICE_DEVIATION_BPS, LIQUIDITY_TWAP_MIN_WINDOW_SECONDS, UNSTAKED_MINT_SEED,
        USDC_LIQUIDITY_TOKEN_ACCOUNT_SEED, USDC_MINT_ADDRESS,
    },
    error::ComptokenError,
    raydium::{
        self,
        accounts::{ObservationState, PoolState},
        cpi::accounts::{Deposit, SwapBaseInput},
        program::RaydiumCpSwap,
    },
    state::global_data::GlobalData,
};

#[derive(Accounts)]
#[instruction()]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    #[account(
        seeds = [UNSTAKED_MINT_SEED],
        bump,
        mint::token_program = token_2022_program,
    )]
    pub unstaked_mint: InterfaceAccount<'info, Mint>,

    #[account(address = USDC_MINT_ADDRESS)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// validated against pool_state in the handler
    #[account(mut)]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [COMPTOKEN_LIQUIDITY_TOKEN_ACCOUNT_SEED],
        bump,
        token::mint = unstaked_mint,
        token::authority = global_data,
        token::token_program = token_2022_program,
    )]
    pub comptoken_liquidity_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [USDC_LIQUIDITY_TOKEN_ACCOUNT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = global_data,
        token::token_program = token_program,
    )]
    pub usdc_liquidity_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = lp_mint,
        associated_token::authority = global_data,
        associated_token::token_program = token_program,
    )]
    pub comptoken_lp_token_account: InterfaceAccount<'info, TokenAccount>,

    /// validated against pool_state in the handler
    #[account(mut, token::mint = unstaked_mint)]
    pub pool_comptoken_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// validated against pool_state in the handler
    #[account(mut, token::mint = usdc_mint)]
    pub pool_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = COMP_USDC_POOL_ADDRESS)]
    pub pool_state: AccountLoader<'info, PoolState>,

    /// address validated against pool_state in the handler
    #[account(
        constraint = amm_config.trade_fee_rate == 0 @ ComptokenError::LiquidityPoolFeeNotZero,
    )]
    pub amm_config: Account<'info, raydium::accounts::AmmConfig>,

    /// CHECK: Raydium's pool authority PDA, validated by the CPI program itself.
    #[account(
        seeds = [raydium::constants::AUTH_SEED],
        seeds::program = raydium_cp_swap_program.key(),
        bump,
    )]
    pub raydium_authority: UncheckedAccount<'info>,

    /// validated against pool_state in the handler
    #[account(mut)]
    pub observation_state: AccountLoader<'info, ObservationState>,

    pub raydium_cp_swap_program: Program<'info, RaydiumCpSwap>,

    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Swaps the comptoken that daily_distribution minted to the program's working balance for usdc, then
/// deposits both as liquidity in the Raydium CP-swap pool. Kept separate from daily_distribution so
/// that a pool-side failure (drained or paused pool, CPI error, compute limit) only defers the deposit
/// rather than reverting the day's yield/UBI bookkeeping. Permissionless; does nothing when there is
/// no working balance.
pub fn add_liquidity(mut ctx: Context<AddLiquidity>) -> Result<()> {
    if ctx.accounts.comptoken_liquidity_token_account.amount == 0 {
        msg!("No comptoken to add as liquidity");
        return Ok(());
    }
    add_liquidity_pool_share(&mut ctx)
}

/// Computes how many comptokens to swap into a fee-free CPMM pool so that the comptoken/usdc
/// ratio we hold afterwards matches the pool's ratio, letting the whole balance be deposited.
///
/// P: pool supply comp
/// Q: pool supply usdc
/// C: comptokens to deposit
/// R: our init usdc supply
/// x: comptokens to swap
/// u: usdc after swap
/// -> C - x: comptokens after swap
/// -> R + u: usdc after swap
///
/// PQ = (P + x)(Q - u) | (cpmm formula)
/// (P + x) / (Q - u) = (C - x) / (R + u) | (ratio of pool tokens after swap = ratio of our tokens after swap)
/// plug into wolfram alpha, solve for x, u
/// x = sqrt(PQ(P + C) / (Q + R)) - P
///
/// The result is clamped to `[0, C]`; it is 0 when we already hold relatively more usdc than the
/// pool, or when there is no usdc on either side to price against.
fn comptoken_swap_amount(
    pool_comp_supply: u64, pool_usdc_supply: u64, trade_comp_supply: u64, trade_usdc_supply: u64,
) -> u64 {
    let pool_init_usdc_supply = U256::from(pool_usdc_supply); // Q
    let trade_init_usdc_supply = U256::from(trade_usdc_supply); // R
    let total_init_usdc_supply = pool_init_usdc_supply + trade_init_usdc_supply; // Q + R
    let pool_init_comp_supply = U256::from(pool_comp_supply); // P
    let trade_init_comp_supply = U256::from(trade_comp_supply); // C
    let total_init_comp_supply = trade_init_comp_supply + pool_init_comp_supply; // P + C

    if total_init_usdc_supply == U256::ZERO {
        return 0;
    }

    // unwrap_or branches require inputs close to u64::max, which implies that a) comp or usdc is nearing
    // it's theoretical max supply and b) most of it is in this pool. neither are likely
    let radicand =
        u128::try_from(pool_init_comp_supply * pool_init_usdc_supply * total_init_comp_supply / total_init_usdc_supply)
            .unwrap_or(u128::MAX);
    u64::try_from(radicand.isqrt().saturating_sub(pool_comp_supply as u128))
        .unwrap_or(u64::MAX)
        .min(trade_comp_supply)
}

/// Time-weighted average pool prices `(token_1 per token_0, token_0 per token_1)` in Q32.32, from
/// Raydium's observation ring buffer, over a window of at least `min_window` seconds. Returns None
/// if the pool doesn't have that much price history yet.
///
/// Raydium samples the pre-swap price and accumulates it over the time elapsed since its last
/// update, so swaps in the current slot (e.g. a sandwich's front-run) can't move this value.
fn pool_twap_x32(observation_state: &ObservationState, min_window: u64) -> Option<(u128, u128)> {
    if !observation_state.initialized {
        return None;
    }
    let observations = &observation_state.observations;
    let latest_index = observation_state.observation_index as usize;
    let latest = observations[latest_index];
    // updates within 15s of the latest observation accumulate into it in place without changing its
    // block_timestamp, so its cumulatives run up to last_update_timestamp. older observations have the
    // same skew (< 15s), which is small enough we are willing to ignore it.
    let end_timestamp = observation_state.last_update_timestamp;

    // walk backwards from the latest observation to the newest one that is at least min_window old
    for offset in 1..observations.len() {
        let observation = observations[(latest_index + observations.len() - offset) % observations.len()];
        if observation.block_timestamp == 0 {
            return None; // never written
        }
        let elapsed = end_timestamp.saturating_sub(observation.block_timestamp);
        if elapsed >= min_window {
            // cumulatives are designed to wrap
            let token_0_price_x32 =
                latest.cumulative_token_0_price_x32.wrapping_sub(observation.cumulative_token_0_price_x32)
                    / elapsed as u128;
            let token_1_price_x32 =
                latest.cumulative_token_1_price_x32.wrapping_sub(observation.cumulative_token_1_price_x32)
                    / elapsed as u128;
            return Some((token_0_price_x32, token_1_price_x32));
        }
    }
    None
}

/// Whether the pool's spot price is within `max_deviation_bps` of its TWAP.
fn spot_price_within_twap(
    vault_0_amount: u64, vault_1_amount: u64, (twap_0_x32, twap_1_x32): (u128, u128), max_deviation_bps: u64,
) -> bool {
    // compare in whichever direction the price is >= 1, where Q32.32 keeps more relative precision
    let (twap_x32, numerator, denominator) = if twap_0_x32 >= twap_1_x32 {
        (twap_0_x32, vault_1_amount, vault_0_amount)
    } else {
        (twap_1_x32, vault_0_amount, vault_1_amount)
    };
    if twap_x32 == 0 || denominator == 0 {
        return false;
    }
    // can't overflow: spot and twap are < 2^96, so these products are < 2^110
    let spot_x32 = ((numerator as u128) << 32) / denominator as u128;
    spot_x32.abs_diff(twap_x32) * 10_000 <= twap_x32 * max_deviation_bps as u128
}

/// Swaps comptoken for usdc, then deposits as liquidity. Skips both (leaving the balance for a later
/// call) when the pool's spot price deviates from its TWAP, which is what an attacker sandwiching
/// this permissionless instruction would have to cause.
fn add_liquidity_pool_share(ctx: &mut Context<AddLiquidity>) -> Result<()> {
    let unstaked_mint_key = ctx.accounts.unstaked_mint.key();
    let usdc_mint_key = ctx.accounts.usdc_mint.key();

    // Raydium orders token_0/token_1 by ascending pubkey, so determine comptoken's side from
    // that ordering rather than assuming a fixed side.
    let comptoken_is_token_0 = unstaked_mint_key < usdc_mint_key;
    let (token_0_mint_key, token_1_mint_key) =
        if comptoken_is_token_0 { (unstaked_mint_key, usdc_mint_key) } else { (usdc_mint_key, unstaked_mint_key) };

    let (comptoken_vault_key, usdc_vault_key) =
        (ctx.accounts.pool_comptoken_vault.key(), ctx.accounts.pool_usdc_vault.key());
    let (token_0_vault_key, token_1_vault_key) =
        if comptoken_is_token_0 { (comptoken_vault_key, usdc_vault_key) } else { (usdc_vault_key, comptoken_vault_key) };

    // load pool_state once and validate every account derived from it here rather than in the
    // account constraints, where each check would re-borrow and re-check the zero-copy account
    let lp_supply = {
        let pool_state = ctx.accounts.pool_state.load()?;
        require_keys_eq!(pool_state.token_0_mint, token_0_mint_key, ErrorCode::ConstraintAddress);
        require_keys_eq!(pool_state.token_1_mint, token_1_mint_key, ErrorCode::ConstraintAddress);
        require_keys_eq!(pool_state.token_0_vault, token_0_vault_key, ErrorCode::ConstraintAddress);
        require_keys_eq!(pool_state.token_1_vault, token_1_vault_key, ErrorCode::ConstraintAddress);
        require_keys_eq!(pool_state.lp_mint, ctx.accounts.lp_mint.key(), ErrorCode::ConstraintAddress);
        require_keys_eq!(pool_state.amm_config, ctx.accounts.amm_config.key(), ErrorCode::ConstraintAddress);
        require_keys_eq!(
            pool_state.observation_key,
            ctx.accounts.observation_state.key(),
            ErrorCode::ConstraintAddress
        );
        pool_state.lp_supply
    };

    let global_data_signer_seeds: &[&[&[u8]]] = &[&[GLOBAL_DATA_SEED, &[ctx.bumps.global_data]]];

    let comptoken_vault_amount_before_swap = ctx.accounts.pool_comptoken_vault.amount;
    let usdc_vault_amount_before_swap = ctx.accounts.pool_usdc_vault.amount;
    require!(comptoken_vault_amount_before_swap > 0, ComptokenError::LiquidityPoolEmpty);

    let (vault_0_amount, vault_1_amount) = if comptoken_is_token_0 {
        (comptoken_vault_amount_before_swap, usdc_vault_amount_before_swap)
    } else {
        (usdc_vault_amount_before_swap, comptoken_vault_amount_before_swap)
    };
    let price_ok = match pool_twap_x32(&*ctx.accounts.observation_state.load()?, LIQUIDITY_TWAP_MIN_WINDOW_SECONDS) {
        Some(twap) => spot_price_within_twap(vault_0_amount, vault_1_amount, twap, LIQUIDITY_MAX_PRICE_DEVIATION_BPS),
        None => false,
    };
    if !price_ok {
        msg!("Pool price deviates from its TWAP (or has too little history); deferring liquidity deposit");
        return Ok(());
    }

    let amount_in = comptoken_swap_amount(
        comptoken_vault_amount_before_swap,
        usdc_vault_amount_before_swap,
        ctx.accounts.comptoken_liquidity_token_account.amount,
        ctx.accounts.usdc_liquidity_token_account.amount,
    );
    // fee-free CPMM output; raydium rejects swaps that would return nothing
    let expected_amount_out = (usdc_vault_amount_before_swap as u128 * amount_in as u128
        / (comptoken_vault_amount_before_swap as u128 + amount_in as u128)) as u64;

    if expected_amount_out > 0 {
        raydium::cpi::swap_base_input(
            CpiContext::new(
                ctx.accounts.raydium_cp_swap_program.to_account_info(),
                SwapBaseInput {
                    payer: ctx.accounts.global_data.to_account_info(),
                    authority: ctx.accounts.raydium_authority.to_account_info(),
                    amm_config: ctx.accounts.amm_config.to_account_info(),
                    pool_state: ctx.accounts.pool_state.to_account_info(),
                    input_token_account: ctx.accounts.comptoken_liquidity_token_account.to_account_info(),
                    output_token_account: ctx.accounts.usdc_liquidity_token_account.to_account_info(),
                    input_vault: ctx.accounts.pool_comptoken_vault.to_account_info(),
                    output_vault: ctx.accounts.pool_usdc_vault.to_account_info(),
                    input_token_program: ctx.accounts.token_2022_program.to_account_info(),
                    output_token_program: ctx.accounts.token_program.to_account_info(),
                    input_token_mint: ctx.accounts.unstaked_mint.to_account_info(),
                    output_token_mint: ctx.accounts.usdc_mint.to_account_info(),
                    observation_state: ctx.accounts.observation_state.to_account_info(),
                },
            )
            .with_signer(global_data_signer_seeds),
            amount_in,
            // minimum_amount_out: a quote from the current reserves would be computed from the same state
            // an attacker already moved, so it adds no protection; the TWAP check above is the guard.
            0,
        )?;
    }

    // update zero-copy accounts after swap
    ctx.accounts.comptoken_liquidity_token_account.reload()?;
    ctx.accounts.usdc_liquidity_token_account.reload()?;
    ctx.accounts.pool_comptoken_vault.reload()?;
    ctx.accounts.pool_usdc_vault.reload()?;
    let usdc_token_amount = ctx.accounts.usdc_liquidity_token_account.amount;
    let comp_token_amount = ctx.accounts.comptoken_liquidity_token_account.amount;

    if comp_token_amount == 0 || usdc_token_amount == 0 {
        return Ok(());
    }

    let comptoken_vault_amount = ctx.accounts.pool_comptoken_vault.amount;
    let usdc_vault_amount = ctx.accounts.pool_usdc_vault.amount;

    require!(comptoken_vault_amount > 0 && usdc_vault_amount > 0, ComptokenError::LiquidityPoolEmpty);

    // lp_token_amount achievable without exceeding either side's proportional share of the pool,
    // computed from current reserves. Rounded down (and shaved slightly) to avoid an off-by-one
    // revert from Raydium's own required-amount rounding.
    let lp_from_comptoken = (comp_token_amount as u128) * (lp_supply as u128) / (comptoken_vault_amount as u128);
    let lp_from_usdc = (usdc_token_amount as u128) * (lp_supply as u128) / (usdc_vault_amount as u128);
    let lp_token_amount = lp_from_comptoken.min(lp_from_usdc);
    if lp_token_amount <= 1 {
        return Ok(());
    }
    let lp_token_amount = lp_token_amount - (lp_token_amount / 1000 + 1); // ~0.1% conservative margin
    let lp_token_amount = u64::try_from(lp_token_amount).unwrap_or(u64::MAX);

    struct DepositToken<'a> {
        max_amount: u64,
        account: AccountInfo<'a>,
        vault: AccountInfo<'a>,
        mint: AccountInfo<'a>,
    }

    let comp_token = DepositToken {
        max_amount: comp_token_amount,
        account: ctx.accounts.comptoken_liquidity_token_account.to_account_info(),
        vault: ctx.accounts.pool_comptoken_vault.to_account_info(),
        mint: ctx.accounts.unstaked_mint.to_account_info(),
    };

    let usdc_token = DepositToken {
        max_amount: usdc_token_amount,
        account: ctx.accounts.usdc_liquidity_token_account.to_account_info(),
        vault: ctx.accounts.pool_usdc_vault.to_account_info(),
        mint: ctx.accounts.usdc_mint.to_account_info(),
    };

    let (token_0, token_1) = if comptoken_is_token_0 { (comp_token, usdc_token) } else { (usdc_token, comp_token) };

    raydium::cpi::deposit(
        CpiContext::new(
            ctx.accounts.raydium_cp_swap_program.to_account_info(),
            Deposit {
                owner: ctx.accounts.global_data.to_account_info(),
                authority: ctx.accounts.raydium_authority.to_account_info(),
                pool_state: ctx.accounts.pool_state.to_account_info(),
                owner_lp_token: ctx.accounts.comptoken_lp_token_account.to_account_info(),
                token_0_account: token_0.account,
                token_1_account: token_1.account,
                token_0_vault: token_0.vault,
                token_1_vault: token_1.vault,
                token_program: ctx.accounts.token_program.to_account_info(),
                token_program_2022: ctx.accounts.token_2022_program.to_account_info(),
                vault_0_mint: token_0.mint,
                vault_1_mint: token_1.mint,
                lp_mint: ctx.accounts.lp_mint.to_account_info(),
            },
        )
        .with_signer(global_data_signer_seeds),
        lp_token_amount,
        token_0.max_amount,
        token_1.max_amount,
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Simulates a fee-free CPMM swap of `x` comptokens, returning the usdc received.
    fn simulate_swap(pool_comp: u64, pool_usdc: u64, x: u64) -> u64 {
        (pool_usdc as u128 * x as u128 / (pool_comp as u128 + x as u128)) as u64
    }

    /// Asserts that after swapping, our comp/usdc ratio matches the pool's (relative error, compared
    /// via cross-multiplication). Integer flooring of the swap output and isqrt each cost at most
    /// one unit, so the tolerance scales with the smallest post-swap balance.
    fn assert_ratios_match(p: u64, q: u64, c: u64, r: u64) {
        let x = comptoken_swap_amount(p, q, c, r);
        let u = simulate_swap(p, q, x);
        let pool_lhs = (p + x) as f64 * (r + u) as f64;
        let ours_rhs = (c - x) as f64 * (q - u) as f64;
        let rel_err = (pool_lhs - ours_rhs).abs() / pool_lhs.max(ours_rhs);
        let smallest = [p + x, q - u, c - x, r + u].into_iter().min().unwrap() as f64;
        let tolerance = 2.0 / smallest;
        assert!(rel_err <= tolerance, "ratio mismatch: p={p} q={q} c={c} r={r} x={x} u={u} rel_err={rel_err}");
    }

    #[test]
    fn nothing_to_deposit_swaps_nothing() {
        assert_eq!(comptoken_swap_amount(1_000, 1_000, 0, 0), 0);
        assert_eq!(comptoken_swap_amount(1_000, 1_000, 0, 500), 0);
    }

    #[test]
    fn already_balanced_swaps_nothing() {
        // our ratio C/R == pool ratio P/Q
        assert_eq!(comptoken_swap_amount(1_000_000, 2_000_000, 1_000, 2_000), 0);
    }

    #[test]
    fn usdc_heavy_swaps_nothing() {
        assert_eq!(comptoken_swap_amount(1_000, 1_000, 10, 1_000), 0);
    }

    #[test]
    fn exact_solution_with_no_usdc() {
        // x = sqrt(1 * 100 * 4 / 100) - 1 = 1; swapping 1 gives u = 50,
        // leaving pool 2:50 and us 2:50
        assert_eq!(comptoken_swap_amount(1, 100, 3, 0), 1);
        assert_eq!(simulate_swap(1, 100, 1), 50);
    }

    #[test]
    fn post_swap_ratios_match_pool() {
        let cases: &[(u64, u64, u64, u64)] = &[
            (1_000_000_000, 1_000_000_000, 10_000_000, 0),
            (1_000_000_000, 5_000_000, 10_000_000, 0),
            (1_000_000_000, 5_000_000, 10_000_000, 10_000),
            (5_000_000, 1_000_000_000, 100_000, 0),
            (123_456_789_000, 987_654_321, 1_234_567_000, 1_000),
            (10_000_000_000_000, 10_000_000_000_000, 10_000_000_000_000, 0),
        ];
        for &(p, q, c, r) in cases {
            assert_ratios_match(p, q, c, r);
        }
    }

    const Q32: u128 = 1 << 32;

    /// Builds an observation state whose ring buffer holds `(block_timestamp, token_0_price_x32)` samples
    /// in order, accumulated the way raydium does; token_1's price is the reciprocal.
    fn observation_state(samples: &[(u64, u128)]) -> ObservationState {
        let empty = raydium::types::Observation {
            block_timestamp: 0,
            cumulative_token_0_price_x32: 0,
            cumulative_token_1_price_x32: 0,
        };
        let mut observations = [empty; 100];
        let (mut cumulative_0, mut cumulative_1) = (0u128, 0u128);
        let mut previous_timestamp = samples[0].0;
        for (i, &(timestamp, price_0_x32)) in samples.iter().enumerate() {
            let elapsed = (timestamp - previous_timestamp) as u128;
            cumulative_0 = cumulative_0.wrapping_add(price_0_x32 * elapsed);
            cumulative_1 = cumulative_1.wrapping_add(Q32 * Q32 / price_0_x32 * elapsed);
            observations[i] = raydium::types::Observation {
                block_timestamp: timestamp,
                cumulative_token_0_price_x32: cumulative_0,
                cumulative_token_1_price_x32: cumulative_1,
            };
            previous_timestamp = timestamp;
        }
        ObservationState {
            initialized: true,
            observation_index: (samples.len() - 1) as u16,
            pool_id: Pubkey::default(),
            observations,
            last_update_timestamp: previous_timestamp,
            padding: [0; 3],
        }
    }

    #[test]
    fn twap_needs_enough_history() {
        let state = observation_state(&[(1_000, 2 * Q32), (1_500, 2 * Q32)]);
        assert_eq!(pool_twap_x32(&state, 501), None);
        assert_eq!(pool_twap_x32(&state, 500), Some((2 * Q32, Q32 / 2)));
    }

    #[test]
    fn twap_uses_newest_observation_old_enough() {
        // price 1 for 1000s, then 3 for 1000s, then 5 for 100s
        let state = observation_state(&[(10_000, Q32), (11_000, Q32), (12_000, 3 * Q32), (12_100, 5 * Q32)]);
        // window starts at the second observation: (3 * 1000 + 5 * 100) / 1100
        let (twap_0, _) = pool_twap_x32(&state, 1_000).unwrap();
        assert_eq!(twap_0, (3 * 1_000 + 5 * 100) * Q32 / 1_100);
        // window starts at the first observation
        let (twap_0, _) = pool_twap_x32(&state, 1_101).unwrap();
        assert_eq!(twap_0, (1_000 + 3 * 1_000 + 5 * 100) * Q32 / 2_100);
    }

    #[test]
    fn twap_handles_wrapped_cumulatives() {
        let mut state = observation_state(&[(10_000, Q32), (11_000, Q32)]);
        let observations = &mut state.observations;
        observations[0].cumulative_token_0_price_x32 = u128::MAX - 10 * Q32 + 1;
        observations[1].cumulative_token_0_price_x32 = 990 * Q32;
        assert_eq!(pool_twap_x32(&state, 1_000).unwrap().0, Q32);
    }

    #[test]
    fn uninitialized_twap_is_none() {
        let mut state = observation_state(&[(10_000, Q32), (11_000, Q32)]);
        state.initialized = false;
        assert_eq!(pool_twap_x32(&state, 0), None);
    }

    #[test]
    fn spot_price_deviation() {
        // twap: 2 token_1 per token_0
        let twap = (2 * Q32, Q32 / 2);
        assert!(spot_price_within_twap(1_000_000, 2_000_000, twap, 200));
        assert!(spot_price_within_twap(1_000_000, 2_039_000, twap, 200));
        assert!(spot_price_within_twap(1_000_000, 1_961_000, twap, 200));
        assert!(!spot_price_within_twap(1_000_000, 2_041_000, twap, 200));
        assert!(!spot_price_within_twap(1_000_000, 1_959_000, twap, 200));
        // price < 1 is compared in the other direction: 1/2 token_1 per token_0
        let twap = (Q32 / 2, 2 * Q32);
        assert!(spot_price_within_twap(2_000_000, 1_000_000, twap, 200));
        assert!(!spot_price_within_twap(2_100_000, 1_000_000, twap, 200));
        // empty side never passes
        assert!(!spot_price_within_twap(0, 1_000_000, twap, 200));
    }

    #[test]
    fn extreme_inputs() {
        // x = isqrt(1 * MAX * 1001 / MAX) - 1 = 31 - 1
        assert_eq!(comptoken_swap_amount(1, u64::MAX, 1_000, 0), 30);
        // already balanced, so no swap
        assert_eq!(comptoken_swap_amount(u64::MAX, u64::MAX, u64::MAX, u64::MAX), 0);
        // x = isqrt(2^64) - 1
        assert_eq!(comptoken_swap_amount(1, 1, u64::MAX, 0), (1 << 32) - 1);
    }
}
