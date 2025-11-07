use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{MintToChecked, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{GLOBAL_DATA_SEED, MINT_DECIMALS, STAKED_MINT_SEED, UNSTAKED_MINT_SEED, USER_DATA_SEED},
    state::{global_data::GlobalData, user_data::UserDataVerificationStatus},
};

#[derive(Accounts)]
#[instruction()]
pub struct Collect<'info> {
    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, crate::state::user_data::UserData>,

    #[account(
        token::authority = user_wallet,
        token::mint = staked_mint,
        token::token_program = token_program,
    )]
    pub user_staked_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::authority = user_wallet,
        token::mint = unstaked_mint,
        token::token_program = token_program,
    )]
    pub user_unstaked_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [STAKED_MINT_SEED],
        bump,
        mint::token_program = token_program,
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
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    pub token_program: Program<'info, Token2022>,
}

pub fn collect(ctx: Context<Collect>) -> Result<()> {
    let user_staked_token_account = &mut ctx.accounts.user_staked_token_account;
    let principal = user_staked_token_account.amount;

    let user_data = &mut ctx.accounts.user_data;
    let n = user_data.days_since_last_claim();
    let verification_status = user_data.verification_status();

    let global_data = ctx.accounts.global_data.load()?;

    let yields = global_data.daily_distribution.get_yield_for_n_days(n, principal);
    msg!("Calculated yield for {} days on principal {}: {}", n, principal, yields);

    let total_yield = match verification_status {
        UserDataVerificationStatus::Verified => {
            let ubi = global_data.daily_distribution.get_ubi_for_n_days(n);
            msg!("User verified, granting UBI of {}", ubi);
            yields + ubi
        }
        UserDataVerificationStatus::VerificationExpired => {
            msg!("User verification expired no UBI will be granted");
            yields
        }
        UserDataVerificationStatus::Unverified => {
            msg!("User unverified, no UBI will be granted");
            yields
        }
    };
    msg!("Total yield to be minted: {}", total_yield);

    user_data.update_last_claim_timestamp();
    if total_yield != 0 {
        let global_data_bump = ctx.bumps.global_data;
        let signer_seeds: &[&[u8]] = &[GLOBAL_DATA_SEED, &[global_data_bump]];

        anchor_spl::token_2022::mint_to_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                MintToChecked {
                    mint: ctx.accounts.unstaked_mint.to_account_info(),
                    to: ctx.accounts.user_unstaked_token_account.to_account_info(),
                    authority: ctx.accounts.global_data.to_account_info(),
                },
            )
            .with_signer(&[signer_seeds]),
            total_yield,
            MINT_DECIMALS,
        )?;
    }

    Ok(())
}
