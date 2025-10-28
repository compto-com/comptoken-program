use crate::{
    constants::{SECONDS_IN_A_DAY, VERIFICATION_DURATION},
    state::hash::Hash,
    utils::helpers::{get_current_time, normalize_time},
};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum UserDataVerificationStatus {
    NeverVerified,
    Verified,
    VerificationExpired,
}

#[account]
pub struct UserData {
    pub last_claimed_timestamp: i64,

    pub last_verified_timestamp: i64, // 0 if never verified
    pub nulliffier_hash: Hash,

    pub recent_blockhash: Hash,
    pub proofs: Vec<Hash>,
}

impl UserData {
    pub fn init(&mut self, capacity: usize) {
        assert!(self.last_claimed_timestamp == 0); // ensure uninitialized
        *self = Self {
            last_claimed_timestamp: normalize_time(get_current_time()),
            last_verified_timestamp: 0,
            nulliffier_hash: Hash::default(),
            recent_blockhash: Hash::default(),
            proofs: Vec::with_capacity(capacity),
        };
    }

    pub fn space(capacity: usize) -> usize {
        8 + // discriminator
        std::mem::size_of::<Self>() -
        // remove runtime vec size
        std::mem::size_of::<Vec<Hash>>() +
        // add storage-time vec size
        4 + // vec len
        (std::mem::size_of::<Hash>() * capacity) // [Hash; capacity]
    }

    pub fn verification_status(&self) -> UserDataVerificationStatus {
        let today = normalize_time(get_current_time());
        match self.last_verified_timestamp {
            0 => UserDataVerificationStatus::NeverVerified,
            ts if ts + VERIFICATION_DURATION > today => UserDataVerificationStatus::Verified,
            _ => UserDataVerificationStatus::VerificationExpired,
        }
    }

    pub fn update_recent_blockhash(&mut self, recent_blockhash: Hash) {
        if recent_blockhash != self.recent_blockhash {
            self.recent_blockhash = recent_blockhash;
            self.proofs.clear();
        }
    }

    pub fn insert_proof(&mut self, recent_blockhash: Hash, proof: Hash) {
        self.update_recent_blockhash(recent_blockhash);

        assert!(self.proofs.len() < self.proofs.capacity(), "proofs vec is full, consider increasing capacity");

        assert!(!self.proofs.contains(&proof), "proof should be new");
        self.proofs.push(proof);
    }

    pub fn is_current(&self) -> bool {
        self.last_claimed_timestamp == normalize_time(get_current_time())
    }

    pub fn days_since_last_claim(&self) -> usize {
        let now = normalize_time(get_current_time());
        ((now - self.last_claimed_timestamp) / SECONDS_IN_A_DAY) as usize
    }
}
