pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

use constants::*;
use instructions::*;
use state::*;
use utils::*;

declare_id!("F9SW7dcgDHV6QGYcFHyqKtykAdsHvL4BJYA2YP4YkEJX");

#[program]
pub mod comptoken {
    use super::*;

    pub fn collect(ctx: Context<Collect>) -> Result<()> {
        collect::collect(ctx)
    }

    pub fn create_user_data_account(
        ctx: Context<CreateUserDataAccount>, args: CreateUserDataAccountArgs,
    ) -> Result<()> {
        create_user_data_account::create_user_data_account(ctx, args)
    }

    pub fn daily_distribution(ctx: Context<DailyDistribution>) -> Result<()> {
        daily_distribution::daily_distribution(ctx)
    }

    pub fn get_valid_blockhashes(ctx: Context<GetValidBlockhashes>) -> Result<ValidBlockhashes> {
        get_valid_blockhashes::get_valid_blockhashes(ctx)
    }

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::initialize(ctx)
    }

    pub fn resize_user_data_account(
        ctx: Context<ResizeUserDataAccount>, args: ResizeUserDataAccountArgs,
    ) -> Result<()> {
        resize_user_data_account::resize_user_data_account(ctx, args)
    }

    pub fn stake(ctx: Context<Stake>, args: StakeArgs) -> Result<()> {
        stake::stake(ctx, args)
    }

    pub fn unstake(ctx: Context<Unstake>, args: UnstakeArgs) -> Result<()> {
        unstake::unstake(ctx, args)
    }

    #[cfg(feature = "testmode")]
    pub fn test_mint_staked_unchecked(
        ctx: Context<TestMintStakedUnchecked>, args: TestMintStakedUncheckedArgs,
    ) -> Result<()> {
        test_instructions::test_mint_staked_unchecked(ctx, args)
    }

    #[cfg(feature = "testmode")]
    pub fn test_mint_unstaked_unchecked(
        ctx: Context<TestMintUnstakedUnchecked>, args: TestMintUnstakedUncheckedArgs,
    ) -> Result<()> {
        test_instructions::test_mint_unstaked_unchecked(ctx, args)
    }
}
