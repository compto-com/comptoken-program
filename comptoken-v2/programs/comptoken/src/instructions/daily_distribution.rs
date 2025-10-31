use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::{GLOBAL_DATA_SEED, STAKED_MINT_SEED, UNSTAKED_MINT_SEED},
    state::global_data::GlobalData,
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
        seeds = [UNSTAKED_MINT_SEED],
        bump,
    )]
    pub unstaked_mint: InterfaceAccount<'info, Mint>,
}

pub fn daily_distribution(ctx: Context<DailyDistribution>) -> Result<()> {
    let mut global_data = ctx.accounts.global_data.load_mut()?;
    let staked_mint = &ctx.accounts.staked_mint;
    let unstaked_mint = &ctx.accounts.unstaked_mint;

    let distribution = global_data
        .daily_distribution
        .daily_distribution(staked_mint.supply, unstaked_mint.supply);

    msg!(
        "Daily distribution calculated: yield={} ubi={} early_adopter_ubi={}",
        distribution.yield_amount,
        distribution.ubi_amount,
        distribution.early_adopter_ubi_amount
    );

    Ok(())
}
