use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::slot_hashes::SlotHashes;

use crate::{
    hash::Hash,
    helpers::{get_current_time, normalize_time},
    state::error::ComptokenError,
    ANNOUNCEMENT_INTERVAL, SECONDS_IN_A_DAY,
};

#[repr(C)]
#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct ValidBlockhashes {
    pub announced_blockhash: Hash,
    pub announced_blockhash_time: i64,
    pub valid_blockhash: Hash,
    pub valid_blockhash_time: i64,
}

impl ValidBlockhashes {
    pub fn init(&mut self, slot_hash_account: &UncheckedAccount<'_>) -> Result<()> {
        require_eq!(self.announced_blockhash_time, 0, ComptokenError::AccountAlreadyInitialized);
        require_eq!(self.valid_blockhash_time, 0, ComptokenError::AccountAlreadyInitialized);
        *self = Self::default();
        self.update(slot_hash_account);
        Ok(())
    }

    pub fn update(&mut self, slot_hash_account: &UncheckedAccount<'_>) {
        if self.is_announced_blockhash_stale() {
            self.announced_blockhash = get_most_recent_blockhash(slot_hash_account);
            // This is necessary for the case where a day's update has been "skipped"
            self.announced_blockhash_time =
                normalize_time(get_current_time() + ANNOUNCEMENT_INTERVAL) - ANNOUNCEMENT_INTERVAL;
        }
        if self.is_valid_blockhash_stale() {
            self.valid_blockhash = self.announced_blockhash;
            self.valid_blockhash_time = normalize_time(get_current_time());
        }
    }

    pub fn is_announced_blockhash_stale(&self) -> bool {
        get_current_time() > self.announced_blockhash_time + SECONDS_IN_A_DAY
    }

    pub fn is_valid_blockhash_stale(&self) -> bool {
        get_current_time() > self.valid_blockhash_time + SECONDS_IN_A_DAY
    }
}

fn get_most_recent_blockhash(slot_hash_account: &UncheckedAccount<'_>) -> Hash {
    use anchor_lang::solana_program::sysvar::SysvarId;
    assert_eq!(slot_hash_account.key(), SlotHashes::id()); // sanity check

    // Safety: The sysvar account is guaranteed to be of the correct type by the above check.
    // slot hashes is too large to deserialize, so we use a zero copy approach. based on the
    // implementation proposed on https://github.com/solana-labs/solana/issues/33015
    let data = slot_hash_account.try_borrow_data().expect("slot hash should be unborrowed");
    let len: u64 = *bytemuck::from_bytes(&data[0..8]);
    let slot_hashes: &[SlotHash] = bytemuck::cast_slice(&data[8..8 + len as usize * 40]);

    slot_hashes.first().expect("slot hashes should not be empty").hash
}

#[repr(C)]
#[derive(Copy, Clone, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub struct SlotHash {
    slot: u64,
    hash: Hash,
}
