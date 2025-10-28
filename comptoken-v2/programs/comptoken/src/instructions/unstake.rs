use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{burn, mint_to_checked, Burn, MintToChecked, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{GLOBAL_DATA_SEED, MINT_DECIMALS, STAKED_MINT_SEED, UNSTAKED_MINT_SEED, USER_DATA_SEED},
    state::{global_data::GlobalData, user_data::UserData},
};

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    #[account(
        seeds = [STAKED_MINT_SEED],
        bump,
        mint::token_program = token_program,
    )]
    pub mint_staked: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [UNSTAKED_MINT_SEED],
        bump,
        mint::token_program = token_program,
    )]
    pub mint_unstaked: InterfaceAccount<'info, Mint>,
    pub user_wallet: Signer<'info>,

    #[account(mut, seeds = [USER_DATA_SEED, user_wallet.key().as_ref()], bump)]
    pub user_data: Account<'info, UserData>,

    #[account(
        mut,
        associated_token::mint = mint_staked,
        associated_token::authority = user_wallet,
        token::token_program = token_program,
    )]
    pub user_staked_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint_unstaked,
        token::authority = user_wallet, // TODO: should we allow unstaking to arbitrary accounts? I think not, it makes more sense to me to force a separate transfer after unstaking if desired
        token::token_program = token_program,
    )]
    pub user_unstaked_token_account: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub struct UnstakeArgs {
    amount: u64,
}

pub fn unstake(ctx: Context<Unstake>, args: UnstakeArgs) -> Result<()> {
    let user_staked_token_account = &mut ctx.accounts.user_staked_token_account;
    let user_unstaked_token_account = &mut ctx.accounts.user_unstaked_token_account;
    let user_data = &mut ctx.accounts.user_data;

    assert!(user_staked_token_account.amount >= args.amount, "Insufficient staked token balance");
    assert!(user_data.is_current(), "User data is not current"); // prevent staking until user has collected outstanding rewards

    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint_staked.to_account_info(),
                from: user_staked_token_account.to_account_info(),
                authority: ctx.accounts.global_data.to_account_info(),
            },
        ),
        args.amount,
    )?;

    mint_to_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintToChecked {
                mint: ctx.accounts.mint_unstaked.to_account_info(),
                to: user_unstaked_token_account.to_account_info(),
                authority: ctx.accounts.global_data.to_account_info(),
            },
        ),
        args.amount,
        MINT_DECIMALS,
    )?;

    Ok(())
}
