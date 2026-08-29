use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{
        GLOBAL_DATA_SEED, NULLIFIER_SEED, REVERIFY_SIGNAL_ACTION, UNSTAKED_MINT_SEED, UNVERIFY_SIGNAL_ACTION,
        USER_DATA_SEED, VERIFY_SIGNAL_ACTION, WORLD_ID_V4_ACTION, WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN,
        WORLD_ID_V4_RP_ID, WORLD_ID_V4_SESSION_SEED,
    },
    instructions::verification::common::{reverify_common, unverify_common, verify_common},
    state::{
        error::ComptokenError,
        ext::world_id_program::WorldIdProgram,
        global_data::GlobalData,
        hash::Hash,
        nullifier::NullifierV4,
        session::WorldIdV4Session,
        user_data::{UserData, Verification},
    },
};

/// Fields common to every World ID v4 proof.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WorldIdV4ProofCommon {
    pub proof: [Hash; 5],
    pub nullifier_hash: Hash,
    pub nonce: Hash,
    pub expires_at_min: u64,
    pub issuer_schema_id: u64,
}

/// Proves the caller is a unique human for the configured rp/action. Its `nullifier_hash` is
/// the one recorded on-chain to prevent an identity from verifying more than one wallet.
/// ties the uniqueness proof to a specific session.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SessionUniquenessProof {
    common: WorldIdV4ProofCommon,
    pub session_id: Hash,
}

impl std::ops::Deref for SessionUniquenessProof {
    type Target = WorldIdV4ProofCommon;

    fn deref(&self) -> &Self::Target {
        &self.common
    }
}

/// Proves the caller controls a specific session. Carries its own `nullifier_hash` (unused by
/// comptoken - session uniqueness is enforced via the `session_id` PDA instead), and the
/// `session_id` being bound to.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SessionProof {
    common: WorldIdV4ProofCommon,
    pub session_id: Hash,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VerifyArgs {
    pub proof: SessionUniquenessProof,
}

impl std::ops::Deref for SessionProof {
    type Target = WorldIdV4ProofCommon;

    fn deref(&self) -> &Self::Target {
        &self.common
    }
}

#[derive(Accounts)]
#[instruction(args: VerifyArgs)]
pub struct Verify<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub user_wallet: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = UserData::space(0),
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
    /// CHECK: placeholder account for v4 verification; not yet validated. TODO: constrain once v4 accounts are finalized.
    pub world_id_root: UncheckedAccount<'info>,

    // Errors if this account already exists
    #[account(
        init,
        payer = payer,
        space = std::mem::size_of::<NullifierV4>() + 8,
        seeds = [NULLIFIER_SEED, args.proof.nullifier_hash.as_ref()],
        bump,
    )]
    pub world_id_nullifier: Account<'info, NullifierV4>,

    #[account(
        init,
        payer = payer,
        space = std::mem::size_of::<WorldIdV4Session>() + 8,
        seeds = [WORLD_ID_V4_SESSION_SEED, args.proof.session_id.as_ref()],
        bump,
    )]
    pub world_id_session: Account<'info, WorldIdV4Session>,

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

/// Verifies a World ID uniqueness proof and ties it to a session, records the uniqueness
/// nullifier, creates the session account bound to `user_wallet`, and marks the user as
/// verified with `proof.session_id`.
pub fn verify(ctx: Context<Verify>, args: VerifyArgs) -> Result<()> {
    let signal = hash_signal(ctx.accounts.user_wallet.key(), VERIFY_SIGNAL_ACTION);
    world_id_verify_uniqueness((), &args.proof, signal)?;

    ctx.accounts.world_id_nullifier.session_id = args.proof.session_id;

    // TODO: this enforces that a wallet can't claim early adopter UBI more than once, but is that what we want?
    //       should it be per identity instead?
    verify_common(
        &mut ctx.accounts.user_data,
        ctx.accounts.user_wallet.key(),
        &mut ctx.accounts.world_id_session,
        Verification::Session { id: args.proof.session_id },
        &ctx.accounts.global_data,
        ctx.bumps.global_data,
        &ctx.accounts.token_program,
        &ctx.accounts.unstaked_mint,
        &ctx.accounts.user_unstaked_token_account,
    )
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ReverifyArgs {
    pub session_proof: SessionProof,
}

#[derive(Accounts)]
#[instruction(args: ReverifyArgs)]
pub struct Reverify<'info> {
    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    #[account(
        mut,
        seeds = [WORLD_ID_V4_SESSION_SEED, args.session_proof.session_id.as_ref()],
        bump,
    )]
    pub world_id_session: Account<'info, WorldIdV4Session>,
}

/// Refreshes a user's World ID verification by checking a session proof and updating their
/// verification timestamp. Does not touch the nullifier registry - re-use of an already-bound
/// session is expected and required here.
///
/// The session may already be bound to `user_wallet` (the common case), or unbound after a
/// prior unverify - in which case it is rebound to `user_wallet` here. It must not be bound to
/// a different wallet.
pub fn reverify(ctx: Context<Reverify>, args: ReverifyArgs) -> Result<()> {
    let signal = hash_signal(ctx.accounts.user_wallet.key(), REVERIFY_SIGNAL_ACTION);
    world_id_verify_session((), &args.session_proof, signal)?;

    reverify_common(
        &mut ctx.accounts.user_data,
        &mut ctx.accounts.world_id_session,
        ctx.accounts.user_wallet.key(),
        Verification::Session { id: args.session_proof.session_id },
    )
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UnverifyWithProofArgs {
    pub session_proof: SessionProof,
}

#[derive(Accounts)]
#[instruction(args: UnverifyWithProofArgs)]
pub struct UnverifyWithProof<'info> {
    /// CHECK: identity is proven via the session proof rather than a wallet signature, since the
    /// user may be recovering a session without direct access to sign with this wallet.
    pub user_wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [WORLD_ID_V4_SESSION_SEED, args.session_proof.session_id.as_ref()],
        bump,
        has_one = user_wallet @ ComptokenError::InvalidNullifierOwner,
    )]
    pub world_id_session: Account<'info, WorldIdV4Session>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,
}

/// Removes verification using a World ID session proof to confirm identity (no wallet
/// signature required).
pub fn unverify_with_proof(ctx: Context<UnverifyWithProof>, args: UnverifyWithProofArgs) -> Result<()> {
    let signal = hash_signal(ctx.accounts.user_wallet.key(), UNVERIFY_SIGNAL_ACTION);
    world_id_verify_session((), &args.session_proof, signal)?;

    unverify_common(
        &mut ctx.accounts.user_data,
        &ctx.accounts.global_data,
        &mut ctx.accounts.world_id_session,
        Verification::Session { id: args.session_proof.session_id },
    )?;

    msg!("World ID proof verified and user unverified");
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UnverifyWithSignatureArgs {
    pub session_id: Hash,
}

#[derive(Accounts)]
#[instruction(args: UnverifyWithSignatureArgs)]
pub struct UnverifyWithWalletSignature<'info> {
    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    #[account(
        mut,
        seeds = [WORLD_ID_V4_SESSION_SEED, args.session_id.as_ref()],
        bump,
        has_one = user_wallet @ ComptokenError::InvalidNullifierOwner,
    )]
    pub world_id_session: Account<'info, WorldIdV4Session>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,
}

/// Removes verification. Uses the wallet signature (matching the session's bound wallet) to
/// confirm ownership, without needing a fresh World ID proof.
pub fn unverify_with_wallet_signature(
    ctx: Context<UnverifyWithWalletSignature>, args: UnverifyWithSignatureArgs,
) -> Result<()> {
    unverify_common(
        &mut ctx.accounts.user_data,
        &ctx.accounts.global_data,
        &mut ctx.accounts.world_id_session,
        Verification::Session { id: args.session_id },
    )?;

    Ok(())
}

/// Hashes into a single signal value bound into a World ID proof.
///
/// TODO: implement once the v4 world id program's signal hashing scheme is finalized, if it
/// remains the same as in v3, reuse the v3 hashing logic.
fn hash_signal(user_wallet: Pubkey, signal_action: &[u8]) -> Hash {
    let mut combined = user_wallet.as_ref().to_vec();
    combined.extend_from_slice(signal_action);
    todo!()
}

/// Verifies a World ID v4 uniqueness proof.
///
/// TODO: wire up the real CPI once the v4 world id program is available.
fn world_id_verify_uniqueness(
    ctx: (), // TODO: CpiContext once the v4 world id program CPI accounts are known
    proof: &SessionUniquenessProof,
    signal: Hash,
) -> Result<()> {
    let _ = (ctx, proof, signal, WORLD_ID_V4_RP_ID, WORLD_ID_V4_ACTION, WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN);
    // this should call `verifyWithSession` or whatever it is called when it is finalized
    // https://github.com/worldcoin/world-id-protocol/blob/e854d7bfacea53d05e5edad94409789318af401b/contracts/src/core/UnreleasedWorldIDVerifierV3.sol
    todo!()
}

/// Verifies a World ID v4 session-binding proof against `signal`.
///
/// TODO: wire up the real CPI once the v4 world id program is available.
fn world_id_verify_session(
    ctx: (), // TODO: CpiContext once the v4 world id program CPI accounts are known
    proof: &SessionProof,
    signal: Hash,
) -> Result<()> {
    let _ = (ctx, proof, signal);
    todo!()
}
