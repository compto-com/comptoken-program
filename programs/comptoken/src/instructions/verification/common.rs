use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{GLOBAL_DATA_SEED, MINT_DECIMALS},
    state::{
        error::ComptokenError,
        global_data::GlobalData,
        nullifier::Nullifier,
        session::WorldIdV4Session,
        user_data::{UserData, Verification},
    },
};

/// Marks a verification as active in global stats, and mints the one-time early adopter UBI
/// reward if the pool still has capacity and this wallet hasn't claimed it before.
///
/// Must be called after the identity proof has already been verified and `user_data` updated.
pub fn record_verification<'info>(
    global_data_loader: &AccountLoader<'info, GlobalData>, global_data_bump: u8, ubi_eligible: bool,
    token_program: &Program<'info, Token2022>, unstaked_mint: &InterfaceAccount<'info, Mint>,
    user_unstaked_token_account: &InterfaceAccount<'info, TokenAccount>,
) -> Result<()> {
    let mut global_data = global_data_loader.load_mut()?;

    if global_data.daily_distribution.remaining_early_adopter_count > 0 && ubi_eligible {
        msg!("Minting early adopter UBI reward");

        global_data.daily_distribution.remaining_early_adopter_count -= 1;

        let amount = global_data.daily_distribution.per_capita_early_adopter_ubi_amount;

        // release borrow on global data for CPI
        std::mem::drop(global_data);

        anchor_spl::token_2022::mint_to_checked(
            CpiContext::new(
                token_program.to_account_info(),
                anchor_spl::token_2022::MintToChecked {
                    mint: unstaked_mint.to_account_info(),
                    to: user_unstaked_token_account.to_account_info(),
                    authority: global_data_loader.to_account_info(),
                },
            )
            .with_signer(&[&[GLOBAL_DATA_SEED, &[global_data_bump]]]),
            amount,
            MINT_DECIMALS,
        )?;
    }

    Ok(())
}

/// Marks a verification as no longer active in global stats. Early adopter UBI count is never
/// restored - it is only ever decremented on verify.
pub fn clear_verification<'info>(global_data_loader: &AccountLoader<'info, GlobalData>) -> Result<()> {
    let mut global_data = global_data_loader.load_mut()?;
    global_data.daily_distribution.verified_accounts_count -= 1;
    Ok(())
}

pub trait IdentityWallet {
    fn get_user_wallet(&self) -> Pubkey;

    fn clear_identity_wallet(&mut self);

    fn set_identity_wallet(&mut self, user_wallet: Pubkey) -> Result<()>;
}

impl IdentityWallet for Account<'_, WorldIdV4Session> {
    fn get_user_wallet(&self) -> Pubkey {
        self.user_wallet
    }

    fn clear_identity_wallet(&mut self) {
        self.user_wallet = Pubkey::default();
    }

    fn set_identity_wallet(&mut self, user_wallet: Pubkey) -> Result<()> {
        require!(self.user_wallet == Pubkey::default(), ComptokenError::SessionAlreadyInUse);
        self.user_wallet = user_wallet;
        Ok(())
    }
}

impl IdentityWallet for Account<'_, Nullifier> {
    fn get_user_wallet(&self) -> Pubkey {
        self.user_wallet
    }

    fn clear_identity_wallet(&mut self) {
        self.user_wallet = Pubkey::default();
    }

    fn set_identity_wallet(&mut self, user_wallet: Pubkey) -> Result<()> {
        require!(self.user_wallet == Pubkey::default(), ComptokenError::NullifierAlreadyUsed);
        self.user_wallet = user_wallet;
        Ok(())
    }
}

pub fn unverify_common<'info>(
    user_data: &mut Account<'info, UserData>, global_data_loader: &AccountLoader<'info, GlobalData>,
    clear_identity_wallet: &mut impl IdentityWallet, verification: Verification,
) -> Result<()> {
    require!(user_data.is_current(), ComptokenError::UserDataNotCurrent);
    require!(user_data.verification == verification, ComptokenError::InvalidVerification);

    user_data.clear_verification();
    clear_identity_wallet.clear_identity_wallet();
    clear_verification(global_data_loader)
}

pub fn reverify_common<'info>(
    user_data: &mut Account<'info, UserData>, identity_account: &mut impl IdentityWallet, identity: Pubkey,
    verification: Verification,
) -> Result<()> {
    require!(user_data.verification == verification, ComptokenError::InvalidVerification);

    if identity_account.get_user_wallet() == Pubkey::default() {
        // binding a previously verified but unbound identity to a new user wallet
        require!(user_data.is_current(), ComptokenError::UserDataNotCurrent);
        identity_account.set_identity_wallet(identity)?;
    } else {
        require!(identity_account.get_user_wallet() == identity, ComptokenError::InvalidNullifierOwner);
    }

    user_data.update_last_verified_timestamp();

    msg!("World ID proof re-verified");
    Ok(())
}

/// Shared tail of every verify instruction: checks `user_data` is current and not already bound to
/// this verification flow, binds the identity account to `user_wallet`, then updates `user_data`
/// via `set_verification` and records the verification (global count + early adopter UBI).
///
/// The CPI proof check and any version-specific accounts (e.g. v4's extra nullifier-to-session
/// binding) must be handled by the caller before invoking this.
#[allow(clippy::too_many_arguments)]
pub fn verify_common<'info>(
    user_data: &mut Account<'info, UserData>, user_wallet: Pubkey, identity_account: &mut impl IdentityWallet,
    verification: Verification, global_data_loader: &AccountLoader<'info, GlobalData>, global_data_bump: u8,
    token_program: &Program<'info, Token2022>, unstaked_mint: &InterfaceAccount<'info, Mint>,
    user_unstaked_token_account: &InterfaceAccount<'info, TokenAccount>,
) -> Result<()> {
    require!(user_data.is_current(), ComptokenError::UserDataNotCurrent);

    if std::mem::discriminant(&user_data.verification) == std::mem::discriminant(&verification) {
        msg!("Account has already been verified. Use the reverify instruction instead or unverify if needed.");
        return err!(ComptokenError::AccountAlreadyVerified);
    }

    // v4 (Session) verified users may not step down to v3 (Nullifier) verification - only the
    // reverse (upgrading v3 -> v4) is allowed.
    if matches!(user_data.verification, Verification::Session { .. })
        && matches!(verification, Verification::Nullifier { .. })
    {
        msg!("Account is already verified with World ID v4. Downgrading to v3 verification is not allowed.");
        return err!(ComptokenError::AccountAlreadyVerified);
    }

    // Upgrading a v3-verified user to v4 intentionally leaves the old v3 nullifier account
    // orphaned (still bound to user_wallet) rather than clearing it - this makes it marginally
    // harder for a user to hold both a v3 and v4 verification concurrently.

    if user_data.verification == Verification::Unverified {
        global_data_loader.load_mut()?.daily_distribution.verified_accounts_count += 1;
    }

    identity_account.set_identity_wallet(user_wallet)?;

    let ubi_eligible = !user_data.early_adopter_ubi_claimed();
    user_data.set_verification(verification);
    user_data.update_last_verified_timestamp();

    record_verification(
        global_data_loader,
        global_data_bump,
        ubi_eligible,
        token_program,
        unstaked_mint,
        user_unstaked_token_account,
    )?;

    msg!("World ID proof verified");
    Ok(())
}
