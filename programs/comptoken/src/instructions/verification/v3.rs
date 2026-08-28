use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::spl_associated_token_account::solana_program::keccak,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};
use ethnum::u256;

use crate::{
    constants::{
        GLOBAL_DATA_SEED, NULLIFIER_SEED, REVERIFY_SIGNAL_ACTION, UNSTAKED_MINT_SEED, UNVERIFY_SIGNAL_ACTION,
        USER_DATA_SEED, VERIFICATION_TYPE, VERIFY_SIGNAL_ACTION, WORLD_ACTION, WORLD_APP_ID, WORLD_ID_PROOF_SIZE,
    },
    instructions::verification::common::{reverify_common, unverify_common, verify_common},
    state::{
        error::ComptokenError,
        ext::world_id_program::{self, WorldIdConfig, WorldIdLatestRoot, WorldIdProgram, WorldIdRoot},
        global_data::GlobalData,
        hash::Hash,
        nullifier::Nullifier,
        user_data::{UserData, Verification},
    },
};

/// Proof inputs needed to verify a user's World ID membership proof on-chain.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WorldIdVerificationData {
    pub root_hash: Hash,
    pub nullifier_hash: Hash,
    pub proof: [u8; WORLD_ID_PROOF_SIZE],
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

    #[account(
        seeds = [WorldIdRoot::SEED_PREFIX, args.root_hash.as_ref(), VERIFICATION_TYPE],
        seeds::program = world_id_program.key(),
        bump,
    )]
    pub world_id_root: Account<'info, WorldIdRoot>,

    #[account(
        seeds = [WorldIdLatestRoot::SEED_PREFIX, VERIFICATION_TYPE],
        seeds::program = world_id_program.key(),
        bump,
    )]
    pub world_id_latest_root: Account<'info, WorldIdLatestRoot>,

    #[account(
        seeds = [WorldIdConfig::SEED_PREFIX],
        seeds::program = world_id_program.key(),
        bump,
    )]
    pub world_id_config: Account<'info, WorldIdConfig>,

    /// CHECK: handled in instruction logic
    #[account(
        init_if_needed,
        payer = payer,
        space = std::mem::size_of::<Nullifier>() + 8,
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        bump,
    )]
    pub world_id_nullifier: Account<'info, Nullifier>,

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
    // CPI to World ID program to verify proof
    let signal = hash_signal(ctx.accounts.user_wallet.key(), VERIFY_SIGNAL_ACTION);
    world_id_verify(
        CpiContext::new(
            ctx.accounts.world_id_program.to_account_info(),
            world_id_program::cpi::accounts::VerifyGroth16Proof {
                root: ctx.accounts.world_id_root.to_account_info(),
                latest_root: ctx.accounts.world_id_latest_root.to_account_info(),
                config: ctx.accounts.world_id_config.to_account_info(),
            },
        ),
        signal,
        args.root_hash,
        args.nullifier_hash,
        args.proof,
    )?;

    verify_common(
        &mut ctx.accounts.user_data,
        ctx.accounts.user_wallet.key(),
        &mut ctx.accounts.world_id_nullifier,
        Verification::Nullifier { hash: args.nullifier_hash },
        &ctx.accounts.global_data,
        ctx.bumps.global_data,
        &ctx.accounts.token_program,
        &ctx.accounts.unstaked_mint,
        &ctx.accounts.user_unstaked_token_account,
    )
}

#[derive(Accounts)]
#[instruction(args: WorldIdVerificationData)]
pub struct Reverify<'info> {
    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    pub world_id_program: Program<'info, WorldIdProgram>,

    #[account(
        seeds = [WorldIdRoot::SEED_PREFIX, args.root_hash.as_ref(), VERIFICATION_TYPE],
        seeds::program = world_id_program.key(),
        bump,
    )]
    pub world_id_root: Account<'info, WorldIdRoot>,

    #[account(
        seeds = [WorldIdLatestRoot::SEED_PREFIX, VERIFICATION_TYPE],
        seeds::program = world_id_program.key(),
        bump,
    )]
    pub world_id_latest_root: Account<'info, WorldIdLatestRoot>,

    #[account(
        seeds = [WorldIdConfig::SEED_PREFIX],
        seeds::program = world_id_program.key(),
        bump,
    )]
    pub world_id_config: Account<'info, WorldIdConfig>,

    #[account(
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        has_one = user_wallet @ ComptokenError::InvalidNullifierOwner,
        bump,
    )]
    pub world_id_nullifier: Account<'info, Nullifier>,
}

/// Refreshes a user's World ID verification by checking a proof and updating their verification timestamp.
pub fn reverify(ctx: Context<Reverify>, args: WorldIdVerificationData) -> Result<()> {
    // CPI to World ID program to verify proof
    let signal = hash_signal(ctx.accounts.user_wallet.key(), REVERIFY_SIGNAL_ACTION);
    world_id_verify(
        CpiContext::new(
            ctx.accounts.world_id_program.to_account_info(),
            world_id_program::cpi::accounts::VerifyGroth16Proof {
                root: ctx.accounts.world_id_root.to_account_info(),
                latest_root: ctx.accounts.world_id_latest_root.to_account_info(),
                config: ctx.accounts.world_id_config.to_account_info(),
            },
        ),
        signal,
        args.root_hash,
        args.nullifier_hash,
        args.proof,
    )?;

    reverify_common(&mut ctx.accounts.user_data, Verification::Nullifier { hash: args.nullifier_hash })
}

/// This instruction is called to unverify an account when the user does not have access to the wallet
/// associated with the original verification (e.g. lost keys). This instruction verifies a World ID proof
/// to ensure the user is the same person as the original verification, then removes their verification status.
/// (allowing them to verify again with a new wallet if desired).
#[derive(Accounts)]
#[instruction(args: WorldIdVerificationData)]
pub struct UnverifyWithProofRecovery<'info> {
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

    #[account(
        seeds = [WorldIdRoot::SEED_PREFIX, args.root_hash.as_ref(), VERIFICATION_TYPE],
        seeds::program = world_id_program.key(),
        bump,
    )]
    pub world_id_root: Account<'info, WorldIdRoot>,

    #[account(
        seeds = [WorldIdLatestRoot::SEED_PREFIX, VERIFICATION_TYPE],
        seeds::program = world_id_program.key(),
        bump,
    )]
    pub world_id_latest_root: Account<'info, WorldIdLatestRoot>,

    #[account(
        seeds = [WorldIdConfig::SEED_PREFIX],
        seeds::program = world_id_program.key(),
        bump,
    )]
    pub world_id_config: Account<'info, WorldIdConfig>,

    #[account(
        mut,
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        has_one = user_wallet @ ComptokenError::InvalidNullifierOwner,
        bump,
    )]
    pub world_id_nullifier: Account<'info, Nullifier>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,
}

/// Removes verification. Uses a World ID proof to confirm identity
pub fn unverify_with_proof_recovery(
    ctx: Context<UnverifyWithProofRecovery>, args: WorldIdVerificationData,
) -> Result<()> {
    // CPI to World ID program to verify proof
    let signal = hash_signal(ctx.accounts.user_wallet.key(), UNVERIFY_SIGNAL_ACTION);
    world_id_verify(
        CpiContext::new(
            ctx.accounts.world_id_program.to_account_info(),
            world_id_program::cpi::accounts::VerifyGroth16Proof {
                root: ctx.accounts.world_id_root.to_account_info(),
                latest_root: ctx.accounts.world_id_latest_root.to_account_info(),
                config: ctx.accounts.world_id_config.to_account_info(),
            },
        ),
        signal,
        args.root_hash,
        args.nullifier_hash,
        args.proof,
    )?;

    unverify_common(
        &mut ctx.accounts.user_data,
        &ctx.accounts.global_data,
        &mut ctx.accounts.world_id_nullifier,
        Verification::Nullifier { hash: args.nullifier_hash },
    )?;

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
        mut,
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        has_one = user_wallet @ ComptokenError::InvalidNullifierOwner,
        bump,
    )]
    pub world_id_nullifier: Account<'info, Nullifier>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UnverifyWithWalletSignatureArgs {
    pub nullifier_hash: Hash,
}

/// Removes verification. Uses the wallet signature to confirm ownership.
pub fn unverify_with_wallet_signature(
    ctx: Context<UnverifyWithWalletSignature>, args: UnverifyWithWalletSignatureArgs,
) -> Result<()> {
    unverify_common(
        &mut ctx.accounts.user_data,
        &ctx.accounts.global_data,
        &mut ctx.accounts.world_id_nullifier,
        Verification::Nullifier { hash: args.nullifier_hash },
    )?;

    msg!("user unverified");
    Ok(())
}

pub fn world_id_verify<'info>(
    ctx: CpiContext<'_, '_, '_, 'info, world_id_program::cpi::accounts::VerifyGroth16Proof<'info>>, signal: [u8; 32],
    root: Hash, nullifier_hash: Hash, proof: [u8; WORLD_ID_PROOF_SIZE],
) -> Result<()> {
    world_id_program::cpi::verify_groth16_proof(
        ctx,
        root.to_bytes(),
        *VERIFICATION_TYPE,
        signal,
        nullifier_hash.to_bytes(),
        get_external_nullifier_hash(),
        proof,
    )
}

/// Scopes a signal to a specific wallet/instruction combination, so a proof generated for one
/// instruction cannot be replayed against another within world id's proof validity window.
fn hash_signal(user_wallet_key: Pubkey, signal_action: &[u8]) -> [u8; 32] {
    let mut combined = user_wallet_key.as_ref().to_vec();
    combined.extend_from_slice(signal_action);
    hash_to_field(&combined)
}

fn hash_to_field(val: &[u8]) -> [u8; 32] {
    let hash_result = keccak::hash(val).to_bytes();
    let big_int = u256::from_be_bytes(hash_result);
    let shifted: u256 = big_int >> 8;
    shifted.to_be_bytes()
}

fn get_external_nullifier_hash() -> [u8; 32] {
    let app_hash = hash_to_field(WORLD_APP_ID);
    let mut combined = app_hash.to_vec();
    combined.extend_from_slice(WORLD_ACTION);
    hash_to_field(&combined)
}
