use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_2022::{mint_to_checked, MintToChecked, Token2022},
    token_interface::{Mint, TokenAccount},
};
use ethnum::U256;

use crate::{
    constants::{
        COMPTOKEN_LIQUIDITY_TOKEN_ACCOUNT_SEED, COMP_USDC_POOL_ADDRESS, GLOBAL_DATA_SEED, MINT_DECIMALS,
        STAKED_MINT_SEED, UNSTAKED_MINT_SEED, USDC_LIQUIDITY_TOKEN_ACCOUNT_SEED, USDC_MINT_ADDRESS,
    },
    error::ComptokenError,
    raydium::{
        self,
        accounts::PoolState,
        cpi::accounts::{Deposit, SwapBaseInput},
        program::RaydiumCpSwap,
    },
    state::global_data::GlobalData,
    utils::helpers::{get_current_time, normalize_time},
};

#[derive(Accounts)]
#[instruction()]
pub struct DailyDistribution<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    #[account(
        seeds = [STAKED_MINT_SEED],
        bump,
    )]
    pub staked_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [UNSTAKED_MINT_SEED],
        bump,
        mint::token_program = token_2022_program,
    )]
    pub unstaked_mint: InterfaceAccount<'info, Mint>,

    #[account(address = USDC_MINT_ADDRESS)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        address = pool_state.load()?.lp_mint
    )]
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

    #[account(
        mut,
        constraint = pool_comptoken_vault.key() == pool_state.load()?.token_0_vault
            || pool_comptoken_vault.key() == pool_state.load()?.token_1_vault,
        constraint = pool_comptoken_vault.mint == unstaked_mint.key(),
    )]
    pub pool_comptoken_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = pool_usdc_vault.key() == pool_state.load()?.token_0_vault
            || pool_usdc_vault.key() == pool_state.load()?.token_1_vault,
        constraint = pool_usdc_vault.mint == usdc_mint.key(),
    )]
    pub pool_usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = COMP_USDC_POOL_ADDRESS)]
    pub pool_state: AccountLoader<'info, PoolState>,

    #[account(
        address = pool_state.load()?.amm_config,
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

    #[account(mut, address = pool_state.load()?.observation_key)]
    pub observation_state: AccountLoader<'info, raydium::accounts::ObservationState>,

    pub raydium_cp_swap_program: Program<'info, RaydiumCpSwap>,

    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Calculates and stores the daily distribution amounts for today, mints the liquidity pool's
/// share of comptoken to the program's own working balance, swaps/deposits into the Raydium
/// CP-swap pool as liquidity.
pub fn daily_distribution(mut ctx: Context<DailyDistribution>) -> Result<()> {
    let mut global_data = ctx.accounts.global_data.load_mut()?;
    let staked_mint = &ctx.accounts.staked_mint;
    let unstaked_mint = &ctx.accounts.unstaked_mint;

    if global_data.daily_distribution.last_update_timestamp == normalize_time(get_current_time()) {
        msg!("Daily distribution has already been calculated for today");
        return Ok(());
    }

    let distribution = global_data
        .daily_distribution
        .daily_distribution(staked_mint.supply, unstaked_mint.supply);

    msg!(
        "Daily distribution calculated: yield={} ubi={} early_adopter_ubi={} liquidity_pool={}",
        distribution.yield_amount,
        distribution.ubi_amount,
        distribution.early_adopter_ubi_amount,
        distribution.liquidity_pool_amount
    );

    drop(global_data);

    if distribution.liquidity_pool_amount > 0 {
        mint_to_checked(
            CpiContext::new(
                ctx.accounts.token_2022_program.to_account_info(),
                MintToChecked {
                    mint: ctx.accounts.unstaked_mint.to_account_info(),
                    to: ctx.accounts.comptoken_liquidity_token_account.to_account_info(),
                    authority: ctx.accounts.global_data.to_account_info(),
                },
            )
            .with_signer(&[&[GLOBAL_DATA_SEED, &[ctx.bumps.global_data]]]),
            distribution.liquidity_pool_amount,
            MINT_DECIMALS,
        )?;

        add_liquidity_pool_share(&mut ctx)?;
    }

    Ok(())
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

/// Swaps comptoken for usdc, then deposits as liquidity.
fn add_liquidity_pool_share(ctx: &mut Context<DailyDistribution>) -> Result<()> {
    let unstaked_mint_key = ctx.accounts.unstaked_mint.key();
    let usdc_mint_key = ctx.accounts.usdc_mint.key();

    // Raydium orders token_0/token_1 by ascending pubkey, so determine comptoken's side from
    // that ordering rather than assuming a fixed side.
    let comptoken_is_token_0 = unstaked_mint_key < usdc_mint_key;
    let (token_0_mint_key, token_1_mint_key) =
        if comptoken_is_token_0 { (unstaked_mint_key, usdc_mint_key) } else { (usdc_mint_key, unstaked_mint_key) };

    let lp_supply = {
        let pool_state = ctx.accounts.pool_state.load()?;
        require_keys_eq!(pool_state.token_0_mint, token_0_mint_key, ErrorCode::ConstraintAddress);
        require_keys_eq!(pool_state.token_1_mint, token_1_mint_key, ErrorCode::ConstraintAddress);
        pool_state.lp_supply
    };

    let global_data_signer_seeds: &[&[&[u8]]] = &[&[GLOBAL_DATA_SEED, &[ctx.bumps.global_data]]];

    let comptoken_vault_amount_before_swap = ctx.accounts.pool_comptoken_vault.amount;
    require!(comptoken_vault_amount_before_swap > 0, ComptokenError::LiquidityPoolEmpty);

    let amount_in = comptoken_swap_amount(
        comptoken_vault_amount_before_swap,
        ctx.accounts.pool_usdc_vault.amount,
        ctx.accounts.comptoken_liquidity_token_account.amount,
        ctx.accounts.usdc_liquidity_token_account.amount,
    );

    if amount_in > 0 {
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
            // minimum_amount_out: this is a small, protocol-controlled swap, not user-facing, so
            // slippage is accepted rather than computing a precise quote.
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
