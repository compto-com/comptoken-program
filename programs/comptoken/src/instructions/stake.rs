use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{burn, mint_to_checked, Burn, MintToChecked, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{GLOBAL_DATA_SEED, MINT_DECIMALS, STAKED_MINT_SEED, UNSTAKED_MINT_SEED, USER_DATA_SEED},
    state::{error::ComptokenError, global_data::GlobalData, user_data::UserData},
};

#[derive(Accounts)]
#[instruction(args: StakeArgs)]
pub struct Stake<'info> {
    #[account(
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    #[account(
        mut,
        seeds = [STAKED_MINT_SEED],
        bump,
        mint::token_program = token_program,
    )]
    pub mint_staked: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [UNSTAKED_MINT_SEED],
        bump,
        mint::token_program = token_program,
    )]
    pub mint_unstaked: InterfaceAccount<'info, Mint>,
    pub user_wallet: Signer<'info>,

    #[account(
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    #[account(
        mut,
        associated_token::mint = mint_staked,
        associated_token::authority = user_wallet,
        associated_token::token_program = token_program,
    )]
    pub user_staked_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint_unstaked,
        token::authority = user_wallet,
        token::token_program = token_program,
    )]
    pub user_unstaked_token_account: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct StakeArgs {
    amount: u64,
}

pub fn stake(ctx: Context<Stake>, args: StakeArgs) -> Result<()> {
    let user_staked_token_account = &mut ctx.accounts.user_staked_token_account;
    let user_unstaked_token_account = &mut ctx.accounts.user_unstaked_token_account;
    let user_data = &ctx.accounts.user_data;

    require_gte!(user_unstaked_token_account.amount, args.amount, ComptokenError::InsufficientFunds);
    require!(user_data.is_current(), ComptokenError::UserDataNotCurrent); // prevent staking until user has collected outstanding rewards

    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint_unstaked.to_account_info(),
                from: user_unstaked_token_account.to_account_info(),
                authority: ctx.accounts.user_wallet.to_account_info(),
            },
        )
        .with_signer(&[&[GLOBAL_DATA_SEED, &[ctx.bumps.global_data]]]),
        args.amount,
    )?;

    mint_to_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintToChecked {
                mint: ctx.accounts.mint_staked.to_account_info(),
                to: user_staked_token_account.to_account_info(),
                authority: ctx.accounts.global_data.to_account_info(),
            },
        )
        .with_signer(&[&[GLOBAL_DATA_SEED, &[ctx.bumps.global_data]]]),
        args.amount,
        MINT_DECIMALS,
    )?;

    Ok(())
}
