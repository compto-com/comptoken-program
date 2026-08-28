use anchor_lang::prelude::*;

use crate::{
    constants::{SECONDS_IN_A_DAY, VERIFICATION_DURATION},
    state::{error::ComptokenError, hash::Hash},
    utils::helpers::{get_current_time, normalize_time},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum UserDataVerificationStatus {
    Unverified,
    Verified,
    VerificationExpired,
}

/// Tracks which World ID verification flow (if any) a user is currently bound to.
/// `ubi_claimed` is carried through every variant and is only ever set true, never reset,
/// so the one-time early adopter UBI cannot be re-claimed by unverifying and verifying
/// again (v3, v4, or across versions).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Verification {
    Unverified,
    Nullifier { hash: Hash },
    Session { id: Hash },
}

// UserData has a limit on the number of proofs it can store (just over 300)
// due to size limits on Solana. In practice, no single user should need
// anywhere near that many proofs (current miners should only get 1
// proof/month/asic), so this should only be an issue for stratum servers or
// other large-scale miners that share a single user_data account. (though even
// then, they can just use multiple user accounts if needed)
#[account]
pub struct UserData {
    pub last_claimed_timestamp: i64,

    pub last_verified_timestamp: i64, // 0 if never verified
    pub verification: Verification,

    pub recent_blockhash: Hash,
    pub proofs: Vec<Hash>,
}

impl UserData {
    pub fn init(&mut self, capacity: usize) -> Result<()> {
        require_eq!(self.last_claimed_timestamp, 0, ComptokenError::AccountAlreadyInitialized); // ensure uninitialized
        *self = Self {
            last_claimed_timestamp: normalize_time(get_current_time()),
            last_verified_timestamp: 0,
            verification: Verification::Unverified,
            recent_blockhash: Hash::default(),
            proofs: Vec::with_capacity(capacity),
        };
        Ok(())
    }

    // discriminator + all fields including runtime proofs - runtime size of proofs + vec length (4)
    pub const SIZE_WITHOUT_PROOFS: usize =
        Self::DISCRIMINATOR.len() + std::mem::size_of::<Self>() - std::mem::size_of::<Vec<Hash>>() + 4;

    pub fn space(capacity: usize) -> usize {
        Self::SIZE_WITHOUT_PROOFS + (std::mem::size_of::<Hash>() * capacity)
    }

    pub fn verification_status(&self) -> UserDataVerificationStatus {
        let today = normalize_time(get_current_time());
        if self.verification == Verification::Unverified {
            return UserDataVerificationStatus::Unverified;
        }

        match self.last_verified_timestamp {
            0 => UserDataVerificationStatus::Unverified, // should never happen, but just in case
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

    pub fn insert_proof(&mut self, recent_blockhash: Hash, proof: Hash, max_capacity: usize) -> Result<()> {
        self.update_recent_blockhash(recent_blockhash);
        require_gt!(max_capacity, self.proofs.len(), ComptokenError::UserDataProofsCapacityExceeded);
        require!(!self.proofs.contains(&proof), ComptokenError::DuplicateMiningProof);

        self.proofs.push(proof);
        Ok(())
    }

    pub fn is_current(&self) -> bool {
        self.last_claimed_timestamp == normalize_time(get_current_time())
    }

    pub fn days_since_last_claim(&self) -> usize {
        let now = normalize_time(get_current_time());
        ((now - self.last_claimed_timestamp) / SECONDS_IN_A_DAY) as usize
    }

    pub fn update_last_claim_timestamp(&mut self) {
        self.last_claimed_timestamp = normalize_time(get_current_time());
    }

    pub fn update_last_verified_timestamp(&mut self) {
        self.last_verified_timestamp = normalize_time(get_current_time());
    }

    pub fn clear_verification(&mut self) {
        self.verification = Verification::Unverified;
    }

    pub fn set_verification(&mut self, verification: Verification) {
        self.verification = verification;
    }

    pub fn early_adopter_ubi_claimed(&self) -> bool {
        self.last_verified_timestamp != 0
    }
}

#[constant]
pub const USER_DATA_SIZE_WITHOUT_PROOFS: u64 = UserData::SIZE_WITHOUT_PROOFS as u64;
