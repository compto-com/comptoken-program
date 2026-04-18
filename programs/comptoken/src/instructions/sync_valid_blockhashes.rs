use anchor_lang::prelude::*;

use crate::{
    constants::GLOBAL_DATA_SEED,
    state::{global_data::GlobalData, hash::Hash},
};

#[derive(Accounts)]
#[instruction()]
pub struct SyncValidBlockhashes<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    /// CHECK: SlotHashes sysvar account
    #[account(constraint = slot_hashes.key() == anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>, // Sysvar account, but Sysvar<'_, SlotHashes> deserializes it, which fails
}

/// The announced and currently valid blockhashes after a sync operation.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CurrentBlockhashes {
    announced: Hash,
    valid: Hash,
}

/// Updates the program's mining blockhash window, and returns the current announced and valid blockhashes.
pub fn sync_valid_blockhashes(ctx: Context<SyncValidBlockhashes>) -> Result<CurrentBlockhashes> {
    let mut global_data = ctx.accounts.global_data.load_mut()?;

    global_data.valid_blockhashes.update(&ctx.accounts.slot_hashes);

    Ok(CurrentBlockhashes {
        announced: global_data.valid_blockhashes.announced_blockhash,
        valid: global_data.valid_blockhashes.valid_blockhash,
    })
}
