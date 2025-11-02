use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::spl_associated_token_account::solana_program::keccak,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};
use ethnum::u256;

use crate::{
    constants::{
        GLOBAL_DATA_SEED, NULLIFIER_SEED, UNSTAKED_MINT_SEED, USER_DATA_SEED, WORLD_ACTION, WORLD_APP_ID,
        WORLD_ID_PROOF_SIZE, WORLD_VERIFICATION_TYPE,
    },
    state::{
        error::ComptokenError, ext::world_id_program, global_data::GlobalData, hash::Hash, nullifier::Nullifier,
        user_data::UserData,
    },
};

pub struct WorldIdVerifyProof<'info> {
    pub root: AccountInfo<'info>,
    pub latest_root: AccountInfo<'info>,
    pub config: AccountInfo<'info>,
    pub nullifier: AccountInfo<'info>,
    pub payer: AccountInfo<'info>,
}
impl<'info> ToAccountInfos<'info> for WorldIdVerifyProof<'info> {
    fn to_account_infos(&self) -> Vec<AccountInfo<'info>> {
        vec![
            self.root.clone(),
            self.latest_root.clone(),
            self.config.clone(),
            self.nullifier.clone(),
            self.payer.clone(),
        ]
    }
}
impl ToAccountMetas for WorldIdVerifyProof<'_> {
    fn to_account_metas(&self, is_signer: Option<bool>) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new_readonly(*self.root.key, false),
            AccountMeta::new_readonly(*self.latest_root.key, false),
            AccountMeta::new_readonly(*self.config.key, false),
            AccountMeta::new(*self.nullifier.key, false),
            AccountMeta::new(*self.payer.key, is_signer.unwrap_or(false)),
        ]
    }
}
// END TODO: delete

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

    pub world_id_program: Program<'info, world_id_program::WorldIdProgram>,

    #[account(
        seeds = [world_id_program::WORLD_ID_ROOT_SEED, args.root_hash.as_ref()],
        owner = world_id_program.key(),
        bump,
    )]
    pub world_id_root: Account<'info, world_id_program::WorldIdRoot>,

    #[account(
        seeds = [world_id_program::WORLD_ID_LATEST_ROOT_SEED],
        owner = world_id_program.key(),
        bump,
    )]
    pub world_id_latest_root: Account<'info, world_id_program::WorldIdLatestRoot>,

    #[account(
        seeds = [world_id_program::WORLD_ID_CONFIG_SEED],
        owner = world_id_program.key(),
        bump,
    )]
    pub world_id_config: Account<'info, world_id_program::WorldIdConfig>,

    #[account(
        init_if_needed,
        payer = payer,
        space = std::mem::size_of::<Nullifier>() + 8,
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        constraint = world_id_nullifier.load()?.user_wallet == Pubkey::default() @ ComptokenError::NullifierAlreadyUsed,
        bump,
    )]
    pub world_id_nullifier: AccountLoader<'info, Nullifier>,

    #[account(
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    #[account(
        seeds = [UNSTAKED_MINT_SEED],
        bump,
        mint::token_program = token_program,
    )]
    pub unstaked_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn verify(ctx: Context<Verify>, args: WorldIdVerificationData) -> Result<()> {
    let user_data = &mut ctx.accounts.user_data;

    if !user_data.is_current() {
        return err!(ComptokenError::UserDataNotCurrent);
    }

    // 1. check if nullifier is used
    let mut nullifier = if ctx.accounts.world_id_nullifier.to_account_info().data_is_empty() {
        ctx.accounts.world_id_nullifier.load_init()?
    } else {
        ctx.accounts.world_id_nullifier.load_mut()?
    };

    nullifier.user_wallet = ctx.accounts.user_wallet.key();

    // 2. CPI to World ID program to verify proof

    world_id_verify(
        CpiContext::new(
            ctx.accounts.world_id_program.to_account_info(),
            world_id_program::cpi::accounts::VerifyGroth16Proof {
                root: ctx.accounts.world_id_root.to_account_info(),
                latest_root: ctx.accounts.world_id_latest_root.to_account_info(),
                config: ctx.accounts.world_id_config.to_account_info(),
            },
        ),
        ctx.accounts.user_wallet.key(),
        args.root_hash,
        args.nullifier_hash,
        args.proof,
    )?;

    // 3. update user data
    user_data.set_nullifier_hash(args.nullifier_hash);

    msg!("World ID proof verified");
    Ok(())
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

    pub world_id_program: Program<'info, world_id_program::WorldIdProgram>,

    #[account(
        seeds = [world_id_program::WORLD_ID_ROOT_SEED, args.root_hash.as_ref()],
        owner = world_id_program.key(),
        bump,
    )]
    pub world_id_root: Account<'info, world_id_program::WorldIdRoot>,

    #[account(
        seeds = [world_id_program::WORLD_ID_LATEST_ROOT_SEED],
        owner = world_id_program.key(),
        bump,
    )]
    pub world_id_latest_root: Account<'info, world_id_program::WorldIdLatestRoot>,

    #[account(
        seeds = [world_id_program::WORLD_ID_CONFIG_SEED],
        owner = world_id_program.key(),
        bump,
    )]
    pub world_id_config: Account<'info, world_id_program::WorldIdConfig>,

    #[account(
        mut,
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        has_one = user_wallet @ ComptokenError::InvalidNullifierOwner,
        bump,
    )]
    pub world_id_nullifier: AccountLoader<'info, Nullifier>,
}

pub fn reverify(ctx: Context<Reverify>, args: WorldIdVerificationData) -> Result<()> {
    let user_data = &mut ctx.accounts.user_data;

    // does not matter if user data is current or not for re-verification
    require!(user_data.nullifier_hash == args.nullifier_hash, ComptokenError::InvalidNullifierHash);

    // CPI to World ID program to verify proof

    world_id_verify(
        CpiContext::new(
            ctx.accounts.world_id_program.to_account_info(),
            world_id_program::cpi::accounts::VerifyGroth16Proof {
                root: ctx.accounts.world_id_root.to_account_info(),
                latest_root: ctx.accounts.world_id_latest_root.to_account_info(),
                config: ctx.accounts.world_id_config.to_account_info(),
            },
        ),
        ctx.accounts.user_wallet.key(),
        args.root_hash,
        args.nullifier_hash,
        args.proof,
    )?;

    user_data.update_last_verified_timestamp();

    msg!("World ID proof re-verified");
    Ok(())
}

/// This instruction is called to unverify an account when the user does not have access to the wallet
/// associated with the original verification (e.g. lost keys). This instruction verifies a World ID proof
/// to ensure thee user is the same person as the original verification, then removes their verification status.
/// (allowing them to verify again with a new wallet if desired).
#[derive(Accounts)]
#[instruction(args: WorldIdVerificationData)]
pub struct Unverify<'info> {
    /// CHECK: user_wallet is never read or written to, only used to identify ownership of nullifier
    ///        and user data accounts.
    pub user_wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    pub world_id_program: Program<'info, world_id_program::WorldIdProgram>,

    #[account(
        seeds = [world_id_program::WORLD_ID_ROOT_SEED, args.root_hash.as_ref()],
        owner = world_id_program.key(),
        bump,
    )]
    pub world_id_root: Account<'info, world_id_program::WorldIdRoot>,

    #[account(
        seeds = [world_id_program::WORLD_ID_LATEST_ROOT_SEED],
        owner = world_id_program.key(),
        bump,
    )]
    pub world_id_latest_root: Account<'info, world_id_program::WorldIdLatestRoot>,

    #[account(
        seeds = [world_id_program::WORLD_ID_CONFIG_SEED],
        owner = world_id_program.key(),
        bump,
    )]
    pub world_id_config: Account<'info, world_id_program::WorldIdConfig>,

    #[account(
        mut,
        seeds = [NULLIFIER_SEED, args.nullifier_hash.as_ref()],
        has_one = user_wallet @ ComptokenError::InvalidNullifierOwner,
        bump,
    )]
    pub world_id_nullifier: AccountLoader<'info, Nullifier>,
}

pub fn unverify(ctx: Context<Unverify>, args: WorldIdVerificationData) -> Result<()> {
    let user_data = &mut ctx.accounts.user_data;

    require!(user_data.nullifier_hash == args.nullifier_hash, ComptokenError::InvalidNullifierHash);

    // CPI to World ID program to verify proof

    world_id_verify(
        CpiContext::new(
            ctx.accounts.world_id_program.to_account_info(),
            world_id_program::cpi::accounts::VerifyGroth16Proof {
                root: ctx.accounts.world_id_root.to_account_info(),
                latest_root: ctx.accounts.world_id_latest_root.to_account_info(),
                config: ctx.accounts.world_id_config.to_account_info(),
            },
        ),
        ctx.accounts.user_wallet.key(),
        args.root_hash,
        args.nullifier_hash,
        args.proof,
    )?;

    // Clear verification status
    user_data.clear_nullifier_hash(); // also updates last verified timestamp to 0
    let mut nullifier = ctx.accounts.world_id_nullifier.load_mut()?;
    nullifier.user_wallet = Pubkey::default();

    msg!("World ID proof verified and user unverified");
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: Unverify2Args)]
pub struct Unverify2<'info> {
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
    pub world_id_nullifier: AccountLoader<'info, Nullifier>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct Unverify2Args {
    pub nullifier_hash: Hash,
}

pub fn unverify2(ctx: Context<Unverify2>, args: Unverify2Args) -> Result<()> {
    let user_data = &mut ctx.accounts.user_data;

    require!(user_data.is_current(), ComptokenError::UserDataNotCurrent);
    require!(user_data.nullifier_hash == args.nullifier_hash, ComptokenError::InvalidNullifierHash);

    // Clear verification status
    user_data.clear_nullifier_hash(); // also updates last verified timestamp to 0
    let mut nullifier = ctx.accounts.world_id_nullifier.load_mut()?;
    nullifier.user_wallet = Pubkey::default();

    Ok(())
}

pub fn world_id_verify<'info>(
    ctx: CpiContext<'_, '_, '_, 'info, world_id_program::cpi::accounts::VerifyGroth16Proof<'info>>,
    user_wallet_key: Pubkey, root: Hash, nullifier_hash: Hash, proof: [u8; WORLD_ID_PROOF_SIZE],
) -> Result<()> {
    world_id_program::cpi::verify_groth16_proof(
        ctx,
        root.to_bytes(),
        [WORLD_VERIFICATION_TYPE],
        hash_to_field(user_wallet_key.as_ref()),
        nullifier_hash.to_bytes(),
        get_external_nullifier_hash(),
        proof,
    )
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
