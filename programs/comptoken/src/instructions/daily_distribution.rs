use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{mint_to_checked, MintToChecked, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{
        GLOBAL_DATA_SEED, LIQUIDITY_POOL_TOKEN_ACCOUNT_ADDRESS, MINT_DECIMALS, STAKED_MINT_SEED, UNSTAKED_MINT_SEED,
    },
    state::global_data::GlobalData,
    utils::helpers::{get_current_time, normalize_time},
};

#[derive(Accounts)]
#[instruction()]
pub struct DailyDistribution<'info> {
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
        mint::token_program = token_program,
    )]
    pub unstaked_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        address = LIQUIDITY_POOL_TOKEN_ACCOUNT_ADDRESS,
        token::mint = unstaked_mint,
        token::token_program = token_program,
    )]
    pub liquidity_pool_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
}

/// Calculates and stores the daily distribution amounts for today, and mints the
/// liquidity pool's share directly to its token account.
pub fn daily_distribution(ctx: Context<DailyDistribution>) -> Result<()> {
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
                ctx.accounts.token_program.to_account_info(),
                MintToChecked {
                    mint: ctx.accounts.unstaked_mint.to_account_info(),
                    to: ctx.accounts.liquidity_pool_token_account.to_account_info(),
                    authority: ctx.accounts.global_data.to_account_info(),
                },
            )
            .with_signer(&[&[GLOBAL_DATA_SEED, &[ctx.bumps.global_data]]]),
            distribution.liquidity_pool_amount,
            MINT_DECIMALS,
        )?;
    }

    Ok(())
}
