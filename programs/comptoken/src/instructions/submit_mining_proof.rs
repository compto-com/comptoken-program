use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::spl_associated_token_account::solana_program::hash::hashv,
    token_2022::{mint_to_checked, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::{
        GLOBAL_DATA_SEED, MINING_REWARD_AMOUNT, MINT_DECIMALS, PROOF_DIFFICULTY_NBITS, PROOF_DIFFICULTY_NBITS_DEVNET,
        UNSTAKED_MINT_SEED, USER_DATA_SEED,
    },
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

        let nbits: &[u8; 4] = &(PROOF_DIFFICULTY_NBITS).to_le_bytes();

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
    const fn make_target_bytes(nbits: u32) -> Hash {
        // bitcoin nbits format: [1 byte exponent, 3 bytes coefficient] as u32
        // the target is then coefficient * 2^(8 * (exponent - 3))
        // or in other words, the difficulty is a zeroed [u8; 32] with the coefficient placed so that
        // there are exponent - 3 trailing zero bytes (or 32 - exponent leading zero bytes)
        let exponent = ((nbits >> 24) & 0xff) as usize; // extract the top byte which encodes the number of leading zeros
        let mut target_bytes = [0; 32];
        target_bytes[32 - (exponent + 3)] = ((nbits >> 16) & 0xff) as u8;
        target_bytes[32 - (exponent + 2)] = ((nbits >> 8) & 0xff) as u8;
        target_bytes[32 - (exponent + 1)] = (nbits & 0xff) as u8;
        Hash::new_from_array(target_bytes)
    }

    #[allow(dead_code)] // used only in devnet configuration, warns in mainnet configuration
    pub const TARGET_BYTES_DEVNET: Hash = Self::make_target_bytes(PROOF_DIFFICULTY_NBITS_DEVNET);
    #[allow(dead_code)] // used only in mainnet configuration, warns in devnet configuration
    pub const TARGET_BYTES_MAINNET: Hash = Self::make_target_bytes(PROOF_DIFFICULTY_NBITS);

    #[cfg(feature = "devnet")]
    pub const TARGET_BYTES: Hash = Self::TARGET_BYTES_DEVNET;
    #[cfg(feature = "mainnet")]
    pub const TARGET_BYTES: Hash = Self::TARGET_BYTES_MAINNET;

    pub fn new(pubkey: Pubkey, hash: Hash) -> Self {
        Self { pubkey, hash }
    }

    pub fn is_valid(&self) -> bool {
        self.hash < Self::TARGET_BYTES
    }
}

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
