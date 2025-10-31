use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{MintToChecked, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{GLOBAL_DATA_SEED, MINT_DECIMALS, STAKED_MINT_SEED, UNSTAKED_MINT_SEED},
    state::global_data::GlobalData,
};

#[derive(Accounts)]
#[instruction(args: TestMintStakedUncheckedArgs)]
pub struct TestMintStakedUnchecked<'info> {
    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        token::mint = staked_mint,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        mint::token_program = token_program,
        seeds = [STAKED_MINT_SEED],
        bump,
    )]
    pub staked_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    pub token_program: Program<'info, Token2022>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TestMintStakedUncheckedArgs {
    pub amount: u64,
}

pub fn test_mint_staked_unchecked(
    ctx: Context<TestMintStakedUnchecked>, args: TestMintStakedUncheckedArgs,
) -> Result<()> {
    anchor_spl::token_2022::mint_to_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintToChecked {
                mint: ctx.accounts.staked_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.global_data.to_account_info(),
            },
        )
        .with_signer(&[&[GLOBAL_DATA_SEED]]),
        args.amount,
        MINT_DECIMALS,
    )?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(args: TestMintUnstakedUncheckedArgs)]
pub struct TestMintUnstakedUnchecked<'info> {
    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        token::mint = unstaked_mint,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        mint::token_program = token_program,
        seeds = [UNSTAKED_MINT_SEED],
        bump,
    )]
    pub unstaked_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    pub token_program: Program<'info, Token2022>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TestMintUnstakedUncheckedArgs {
    pub amount: u64,
}

pub fn test_mint_unstaked_unchecked(
    ctx: Context<TestMintUnstakedUnchecked>, args: TestMintUnstakedUncheckedArgs,
) -> Result<()> {
    anchor_spl::token_2022::mint_to_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintToChecked {
                mint: ctx.accounts.unstaked_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.global_data.to_account_info(),
            },
        )
        .with_signer(&[&[GLOBAL_DATA_SEED]]),
        args.amount,
        MINT_DECIMALS,
    )?;

    Ok(())
}
