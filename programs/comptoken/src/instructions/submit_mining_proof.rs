use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::spl_associated_token_account::solana_program::hash::hashv,
    token_2022::{mint_to_checked, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{GLOBAL_DATA_SEED, MINING_REWARD_AMOUNT, MINT_DECIMALS, UNSTAKED_MINT_SEED, USER_DATA_SEED},
    state::{
        error::ComptokenError,
        global_data::{GlobalData, ValidBlockhashes},
        hash::Hash,
        user_data::UserData,
    },
};

#[derive(Accounts)]
#[instruction(args: SubmitMiningProofArgs)]
pub struct SubmitMiningProof<'info> {
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
        token::token_program = token_program,
    )]
    pub user_unstaked_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [UNSTAKED_MINT_SEED],
        bump,
    )]
    pub unstaked_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    pub token_program: Program<'info, Token2022>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SubmitMiningProofArgs {
    pub raw_data: [u8; 76],
}

impl SubmitMiningProofArgs {
    fn parse_and_hash_proof(&self, valid_blockhashes: &ValidBlockhashes) -> ComptokenMiningProof {
        let pubkey_bytes = &self.raw_data[0..32];
        let extra_data_bytes = &self.raw_data[32..64];
        let nonce_bytes = &self.raw_data[64..68];
        let version_bytes = &self.raw_data[68..72];
        let timestamp_bytes = &self.raw_data[72..76];

        let valid_blockhash_bytes = &mut valid_blockhashes.valid_blockhash.to_bytes();
        valid_blockhash_bytes.reverse();

        msg!("extra data: {:?}", hex::encode(extra_data_bytes));
        msg!("pubkey: {:?}", hex::encode(pubkey_bytes));
        msg!("valid blockhash: {:?}", hex::encode(&valid_blockhash_bytes));

        let merkleroot_hash = double_sha256(&[extra_data_bytes, pubkey_bytes]);

        let nbits: &[u8; 4] = &(0x180eadd8_u32).to_le_bytes();

        let header = &[
            version_bytes,
            valid_blockhash_bytes,
            merkleroot_hash.as_ref(),
            timestamp_bytes,
            nbits,
            nonce_bytes,
        ];

        msg!("header: {:?}", hex::encode(header.concat()));

        // sanity check
        assert_eq!(header.iter().map(|slice| slice.len()).sum::<usize>(), 80);

        let mut final_hash = double_sha256(header);
        final_hash.reverse();

        msg!("final hash: {:?}", hex::encode(final_hash));
        let hash = Hash::new_from_array(final_hash);

        ComptokenMiningProof::new(Pubkey::new_from_array(pubkey_bytes.try_into().expect("correct size")), hash)
    }
}

struct ComptokenMiningProof {
    pubkey: Pubkey,
    hash: Hash,
}

impl ComptokenMiningProof {
    const TARGET_DIFFICULTY_DEVNET: usize = 29;
    const TARGET_DIFFICULTY_MAINNET: usize = 24;
    #[cfg(feature = "devnet")]
    pub const TARGET_DIFFICULTY: usize = Self::TARGET_DIFFICULTY_DEVNET;
    #[cfg(feature = "mainnet")]
    pub const TARGET_DIFFICULTY: usize = Self::TARGET_DIFFICULTY_MAINNET;

    // The target is 0x0e_ad_d8 followed by <difficulty> zero bytes
    const fn make_target_bytes(difficulty: usize) -> Hash {
        let mut target_bytes = [0; 32];
        target_bytes[32 - (difficulty + 3)] = 0x0e;
        target_bytes[32 - (difficulty + 2)] = 0xad;
        target_bytes[32 - (difficulty + 1)] = 0xd8;
        Hash::new_from_array(target_bytes)
    }

    pub const TARGET_BYTES_DEVNET: Hash = Self::make_target_bytes(Self::TARGET_DIFFICULTY_DEVNET);
    pub const TARGET_BYTES_MAINNET: Hash = Self::make_target_bytes(Self::TARGET_DIFFICULTY_MAINNET);
    pub const TARGET_BYTES: Hash = Self::make_target_bytes(Self::TARGET_DIFFICULTY);

    pub fn new(pubkey: Pubkey, hash: Hash) -> Self {
        Self { pubkey, hash }
    }

    pub fn is_valid(&self) -> bool {
        self.hash < Self::TARGET_BYTES
    }
}

#[constant]
pub const COMPTOKEN_MINING_PROOF_TARGET: Hash = ComptokenMiningProof::TARGET_BYTES_MAINNET;

#[constant]
pub const COMPTOKEN_MINING_PROOF_TARGET_DEVNET: Hash = ComptokenMiningProof::TARGET_BYTES_DEVNET;

fn double_sha256(data: &[&[u8]]) -> [u8; 32] {
    hashv(&[hashv(data).as_ref()]).to_bytes()
}

pub fn submit_mining_proof(ctx: Context<SubmitMiningProof>, args: SubmitMiningProofArgs) -> Result<()> {
    let user_data_len = ctx.accounts.user_data.to_account_info().data_len();
    let user_data_capacity = (user_data_len - UserData::SIZE_WITHOUT_PROOFS) / std::mem::size_of::<Hash>();
    let user_data = &mut ctx.accounts.user_data;
    if !user_data.is_current() {
        return err!(ComptokenError::UserDataNotCurrent);
    }

    let valid_blockhashes = ctx.accounts.global_data.load()?.valid_blockhashes;
    if valid_blockhashes.is_valid_blockhash_stale() {
        return err!(ComptokenError::StaleValidBlockhash);
    }
    let mining_proof = args.parse_and_hash_proof(&valid_blockhashes);

    require_keys_eq!(ctx.accounts.user_wallet.key(), mining_proof.pubkey, ComptokenError::InvalidMiningProof);
    require!(mining_proof.is_valid(), ComptokenError::InvalidMiningProof);
    user_data.insert_proof(valid_blockhashes.valid_blockhash, mining_proof.hash, user_data_capacity)?;

    msg!("Mining proof stored successfully");

    mint_to_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_2022::MintToChecked {
                mint: ctx.accounts.unstaked_mint.to_account_info(),
                to: ctx.accounts.user_unstaked_token_account.to_account_info(),
                authority: ctx.accounts.global_data.to_account_info(),
            },
        )
        .with_signer(&[&[GLOBAL_DATA_SEED, &[ctx.bumps.global_data]]]),
        MINING_REWARD_AMOUNT,
        MINT_DECIMALS,
    )?;

    let global_data = &mut ctx.accounts.global_data.load_mut()?;
    global_data.daily_distribution.total_mined_today += MINING_REWARD_AMOUNT;

    Ok(())
}
