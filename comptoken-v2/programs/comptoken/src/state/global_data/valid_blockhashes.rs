use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::slot_hashes::SlotHashes;

use crate::{
    hash::Hash,
    helpers::{get_current_time, normalize_time},
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
    pub fn init(&mut self, slot_hash_account: &UncheckedAccount<'_>) {
        assert!(self.announced_blockhash_time == 0 && self.valid_blockhash_time == 0); // ensure uninitialized
        *self = Self::default();
        self.update(slot_hash_account);
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
    assert_eq!(slot_hash_account.key(), SlotHashes::id());

    // Safety: The sysvar account is guaranteed to be of the correct type by the above check.
    // slot hashes is too large to deserialize, so we use a zero copy approach. based on the
    // implementation proposed on https://github.com/solana-labs/solana/issues/33015
    let data = slot_hash_account.try_borrow_data().expect("slot hash should be unborrowed");
    let len: usize = usize::from_ne_bytes(data[0..8].try_into().expect("correct size"));
    let slot_hashes_raw = &data[8..];

    // Safety: The slot_hashes_raw is guaranteed to be properly aligned and sized for (u64, Hash)
    assert!(slot_hashes_raw.len() == len * std::mem::size_of::<(u64, Hash)>());
    assert!(slot_hashes_raw.as_ptr() as usize % std::mem::align_of::<(u64, Hash)>() == 0);

    let slot_hashes = unsafe { std::slice::from_raw_parts(slot_hashes_raw.as_ptr() as *const (u64, Hash), len) };

    slot_hashes.first().expect("slot hashes should not be empty").1
}
