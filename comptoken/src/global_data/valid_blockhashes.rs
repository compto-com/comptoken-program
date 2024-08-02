use spl_token_2022::solana_program::{hash::Hash, slot_hashes::SlotHash};

use comptoken_utils::{get_current_time, normalize_time, SEC_PER_DAY};

use crate::{constants::*, VerifiedAccountInfo};

#[repr(C)]
#[derive(Debug)]
pub struct ValidBlockhashes {
    pub announced_blockhash: Hash,
    pub announced_blockhash_time: i64,
    pub valid_blockhash: Hash,
    pub valid_blockhash_time: i64,
}

impl ValidBlockhashes {
    pub(super) fn initialize(&mut self, slot_hash_account: &VerifiedAccountInfo) {
        self.update(slot_hash_account);
    }

    pub fn update(&mut self, slot_hash_account: &VerifiedAccountInfo) {
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
        get_current_time() > self.announced_blockhash_time + SEC_PER_DAY
    }

    pub fn is_valid_blockhash_stale(&self) -> bool {
        get_current_time() > self.valid_blockhash_time + SEC_PER_DAY
    }
}

fn get_most_recent_blockhash(slot_hash_account: &VerifiedAccountInfo) -> Hash {
    // slothashes is too large to deserialize with the normal methods
    // based on https://github.com/solana-labs/solana/issues/33015
    let data = slot_hash_account.try_borrow_data().unwrap();
    let len: usize = usize::from_ne_bytes(data[0..8].try_into().expect("correct size"));
    let slot_hashes: &[SlotHash] =
        unsafe { std::slice::from_raw_parts(data.as_ptr().offset(8) as *const SlotHash, len) };

    // get the hash from the most recent slot
    slot_hashes[0].1
}
