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

declare_id!("7j8p5AoS4z1LCPaDujSae6CXLRLKNThFbK5qqniGw9Nf");

#[cfg(all(feature = "mainnet", feature = "devnet"))]
compile_error!("Features 'mainnet' and 'devnet' cannot be enabled at the same time.");

#[cfg(all(not(feature = "mainnet"), not(feature = "devnet")))]
compile_error!("Either feature 'mainnet' or 'devnet' must be enabled.");

// TODO: go through files and remove/combine msg! calls where appropriate

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

    pub fn submit_mining_proof(ctx: Context<SubmitMiningProof>, args: SubmitMiningProofArgs) -> Result<()> {
        submit_mining_proof::submit_mining_proof(ctx, args)
    }

    pub fn verify(ctx: Context<Verify>, args: WorldIdVerificationData) -> Result<()> {
        verification::verify(ctx, args)
    }

    pub fn reverify(ctx: Context<Reverify>, args: WorldIdVerificationData) -> Result<()> {
        verification::reverify(ctx, args)
    }

    pub fn unverify(ctx: Context<Unverify>, args: WorldIdVerificationData) -> Result<()> {
        verification::unverify(ctx, args)
    }

    pub fn unverify2(ctx: Context<Unverify2>, args: Unverify2Args) -> Result<()> {
        verification::unverify2(ctx, args)
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
