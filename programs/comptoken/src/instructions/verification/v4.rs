use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{GLOBAL_DATA_SEED, MINT_DECIMALS, NULLIFIER_SEED, UNSTAKED_MINT_SEED, USER_DATA_SEED},
    state::{
        error::ComptokenError, ext::world_id_program::WorldIdProgram, global_data::GlobalData, hash::Hash,
        nullifier::NullifierV4, session::WorldIdV4Session, user_data::UserData,
    },
};

// TODO: much of this is duplicated from v3, refactor to share code between v3 and v4 verification instructions

// TODO: move to constants, get correct values
const WORLD_ID_V4_ACTION: &[u8] = b"comptoken-v4";
const WORLD_ID_V4_RP_ID: u64 = 1;
const WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN: u64 = 0; // unconstrained. TODO: do we want to constrain this? if so, what value should we use?
const WORLD_ID_V4_SESSION_SEED: &[u8] = b"world_id_session";

/// Proof inputs needed to verify a user's World ID membership proof on-chain.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WorldIdVerificationData {
    pub proof: [Hash; 5],
    pub nullifier_hash: Hash,
    pub session_id: Hash,
    pub nonce: Hash,
    pub expires_at_min: u64,
    pub issuer_schema_id: u64,
}

#[derive(Accounts)]
#[instruction(args: WorldIdVerificationData)]
pub struct Verify<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    #[account(
        mut,
        token::mint = unstaked_mint,
        token::authority = user_wallet,
    )]
    pub user_unstaked_token_account: InterfaceAccount<'info, TokenAccount>,

    pub world_id_program: Program<'info, WorldIdProgram>,

    // TODO: add any accounts needed for v4 verification
    pub world_id_root: UncheckedAccount<'info>,

    // Errors if this account already exists
    #[account(
        init,
        payer = payer,
        space = std::mem::size_of::<NullifierV4>() + 8,
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        bump,
    )]
    pub world_id_nullifier: Account<'info, NullifierV4>,

    /// CHECK: handled in instruction logic
    #[account(
        init_if_needed,
        payer = payer,
        space = std::mem::size_of::<WorldIdV4Session>() + 8,
        seeds = [WORLD_ID_V4_SESSION_SEED, args.session_id.as_ref()],
        bump,
    )]
    pub world_id_session: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    #[account(
        mut,
        seeds = [UNSTAKED_MINT_SEED],
        bump,
        mint::token_program = token_program,
    )]
    pub unstaked_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

/// Verifies a World ID proof, records the nullifier, and marks the user as verified.
pub fn verify(ctx: Context<Verify>, args: WorldIdVerificationData) -> Result<()> {
    let user_data = &mut ctx.accounts.user_data;

    if !user_data.is_current() {
        return err!(ComptokenError::UserDataNotCurrent);
    }

    let session_acct_info = &ctx.accounts.world_id_session.to_account_info();

    if session_acct_info.data.borrow().len() != std::mem::size_of::<WorldIdV4Session>() + 8 {
        return Err(Error::from(ErrorCode::AccountDidNotDeserialize));
    }

    // 1. check if session is used
    // First inspect the raw account data to determine whether this is a newly created account
    // and to validate the discriminator
    let session_exists = if session_acct_info.data.borrow()[0..8] == [0; 8] {
        // newly created account, initialize discriminator
        ctx.accounts.world_id_session.data.borrow_mut()[0..8].copy_from_slice(WorldIdV4Session::DISCRIMINATOR);
        false
    } else {
        if &session_acct_info.data.borrow()[0..8] != WorldIdV4Session::DISCRIMINATOR {
            return Err(Error::from(ErrorCode::AccountDiscriminatorMismatch));
        }
        true
    };

    let mut session_data = session_acct_info.data.borrow_mut();
    let session: &mut WorldIdV4Session = bytemuck::try_from_bytes_mut(&mut session_data[8..])
        .map_err(|_| Error::from(ErrorCode::AccountDidNotDeserialize))?;

    if session_exists && session.user_wallet != Pubkey::default() {
        return err!(ComptokenError::SessionAlreadyInUse);
    }

    session.user_wallet = ctx.accounts.user_wallet.key();

    // 2. CPI to World ID program to verify proof

    world_id_verify((), &args)?;

    // 3. update user data
    let ubi_eligible = !user_data.early_adopter_ubi_claimed();
    user_data.set_session_id(args.session_id);

    let mut global_data = ctx.accounts.global_data.load_mut()?;

    // 4. update global data
    // if we reach here, the nullifier was not in use (if it existed, the user unverified earlier)
    global_data.daily_distribution.verified_accounts_count += 1;

    // 5. mint early adopter UBI if applicable (only once per wallet, ever)
    if global_data.daily_distribution.remaining_early_adopter_count > 0 && ubi_eligible {
        msg!("Minting early adopter UBI reward");

        global_data.daily_distribution.remaining_early_adopter_count -= 1;

        let amount = global_data.daily_distribution.per_capita_early_adopter_ubi_amount;

        // release borrow on global data for CPI
        std::mem::drop(global_data);

        anchor_spl::token_2022::mint_to_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_2022::MintToChecked {
                    mint: ctx.accounts.unstaked_mint.to_account_info(),
                    to: ctx.accounts.user_unstaked_token_account.to_account_info(),
                    authority: ctx.accounts.global_data.to_account_info(),
                },
            )
            .with_signer(&[&[GLOBAL_DATA_SEED, &[ctx.bumps.global_data]]]),
            amount,
            MINT_DECIMALS,
        )?;
    }

    msg!("World ID proof verified");
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: WorldIdVerificationData)]
pub struct Reverify<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    pub world_id_program: Program<'info, WorldIdProgram>,

    // TODO: add any accounts needed for v4 verification
    pub world_id_root: UncheckedAccount<'info>,

    // Errors if this account already exists
    #[account(
        init,
        payer = payer,
        space = std::mem::size_of::<NullifierV4>() + 8,
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        bump,
    )]
    pub world_id_nullifier: Account<'info, NullifierV4>,

    /// CHECK: handled in instruction logic
    #[account(
        seeds = [WORLD_ID_V4_SESSION_SEED, args.session_id.as_ref()],
        bump,
    )]
    pub world_id_session: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Refreshes a user's World ID verification by checking a proof and updating their verification timestamp.
pub fn reverify(ctx: Context<Reverify>, args: WorldIdVerificationData) -> Result<()> {
    let session_acct_info = &ctx.accounts.world_id_session.to_account_info();

    // 1. check if session is used
    // First inspect the raw account data to determine whether this is a newly created account
    // and to validate the discriminator
    let session_exists = if session_acct_info.data.borrow()[0..8] == [0; 8] {
        // newly created account, initialize discriminator
        ctx.accounts.world_id_session.data.borrow_mut()[0..8].copy_from_slice(WorldIdV4Session::DISCRIMINATOR);
        false
    } else {
        if &session_acct_info.data.borrow()[0..8] != WorldIdV4Session::DISCRIMINATOR {
            return Err(Error::from(ErrorCode::AccountDiscriminatorMismatch));
        }
        true
    };

    let mut session_data = session_acct_info.data.borrow_mut();
    let session: &mut WorldIdV4Session = bytemuck::try_from_bytes_mut(&mut session_data[8..])
        .map_err(|_| Error::from(ErrorCode::AccountDidNotDeserialize))?;

    // if the session exists, it must be owned by the same wallet as the user data account
    if session_exists && session.user_wallet != ctx.accounts.user_wallet.key() {
        // TODO: better error
        return err!(ComptokenError::SessionAlreadyInUse);
    }

    let user_data = &mut ctx.accounts.user_data;

    if !session_exists {
        if user_data.session_id() != Hash::default() {
            // TODO: better error
            return err!(ComptokenError::SessionAlreadyInUse);
        }
        session.user_wallet = ctx.accounts.user_wallet.key();
        user_data.set_session_id(args.session_id);
    }

    // does not matter if user data is current or not for re-verification
    // TODO: better error
    require!(user_data.session_id() == args.session_id, ComptokenError::InvalidNullifierHash);

    // CPI to World ID program to verify proof

    world_id_verify((), &args)?;

    user_data.update_last_verified_timestamp();

    msg!("World ID proof re-verified");
    Ok(())
}

/// This instruction is called to unverify an account when the user does not have access to the wallet
/// associated with the original verification (e.g. lost keys). This instruction verifies a World ID proof
/// to ensure the user is the same person as the original verification, then removes their verification status.
/// (allowing them to verify again with a new wallet if desired).
#[derive(Accounts)]
#[instruction(args: WorldIdVerificationData)]
pub struct UnverifyWithProofRecovery<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: user_wallet is never read or written to, only used to identify ownership of nullifier and user data accounts.
    ///
    /// intentionally not a Signer since the user may not have access to the wallet used in the original verification
    pub user_wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    pub world_id_program: Program<'info, WorldIdProgram>,

    // TODO: add any accounts needed for v4 verification
    pub world_id_root: UncheckedAccount<'info>,

    // Errors if this account already exists
    #[account(
        init,
        payer = payer,
        space = std::mem::size_of::<NullifierV4>() + 8,
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        bump,
    )]
    pub world_id_nullifier: Account<'info, NullifierV4>,

    #[account(
        seeds = [WORLD_ID_V4_SESSION_SEED, args.session_id.as_ref()],
        bump,
    )]
    pub world_id_session: AccountLoader<'info, WorldIdV4Session>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    pub system_program: Program<'info, System>,
}

/// Removes verification. Uses a World ID proof to confirm identity
pub fn unverify_with_proof_recovery(
    ctx: Context<UnverifyWithProofRecovery>, args: WorldIdVerificationData,
) -> Result<()> {
    let user_data = &mut ctx.accounts.user_data;

    // TODO: better error
    require!(user_data.session_id() == args.session_id, ComptokenError::InvalidNullifierHash);

    // CPI to World ID program to verify proof

    world_id_verify((), &args)?;

    // Clear verification status
    user_data.clear_session_id(); // also updates last verified timestamp to 0
    let mut session = ctx.accounts.world_id_session.load_mut()?;
    session.user_wallet = Pubkey::default();

    let mut global_data = ctx.accounts.global_data.load_mut()?;
    global_data.daily_distribution.verified_accounts_count -= 1;
    // do not update early adopter count here - only decremented on verify, never incremented

    msg!("World ID proof verified and user unverified");
    Ok(())
}

/// This instruction is called to unverify an account when the user does not have access to the World Id proof
/// associated with the original verification. This instruction signs the transaction with the wallet used in the
/// original verification to verify ownership of the nullifier account, to ensure the user has ownership of the
/// account, then removes their verification status. (allowing them to verify again with a new proof if desired).
#[derive(Accounts)]
#[instruction(args: UnverifyWithWalletSignatureArgs)]
pub struct UnverifyWithWalletSignature<'info> {
    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    #[account(
        seeds = [WORLD_ID_V4_SESSION_SEED, args.session_id.as_ref()],
        bump,
    )]
    pub world_id_session: AccountLoader<'info, WorldIdV4Session>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UnverifyWithWalletSignatureArgs {
    pub session_id: Hash,
}

/// Removes verification. Uses the wallet signature to confirm ownership.
pub fn unverify_with_wallet_signature(
    ctx: Context<UnverifyWithWalletSignature>, args: UnverifyWithWalletSignatureArgs,
) -> Result<()> {
    let user_data = &mut ctx.accounts.user_data;

    require!(user_data.is_current(), ComptokenError::UserDataNotCurrent);
    // TODO: better error
    require!(user_data.session_id() == args.session_id, ComptokenError::InvalidNullifierHash);

    // Clear verification status
    user_data.clear_session_id(); // also updates last verified timestamp to 0
    let mut session = ctx.accounts.world_id_session.load_mut()?;
    session.user_wallet = Pubkey::default();

    let mut global_data = ctx.accounts.global_data.load_mut()?;
    global_data.daily_distribution.verified_accounts_count -= 1;
    // do not update early adopter count here - only decremented on verify, never incremented

    Ok(())
}

pub fn world_id_verify<'info>(
    ctx: (), // TODO
    data: &WorldIdVerificationData,
) -> Result<()> {
    todo!();
}
