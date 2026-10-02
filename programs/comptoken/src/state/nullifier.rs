use anchor_lang::prelude::*;

use crate::state::hash::Hash;

#[account()]
#[repr(C)]
#[derive(Copy)]
pub struct Nullifier {
    pub user_wallet: Pubkey,
}

/// Safety: all bit-patterns of Nullifier are valid, as it only contains a Pubkey.
unsafe impl bytemuck::Pod for Nullifier {}
/// Safety: Nullifier with all zero bytes is an unused nullifier, but still valid.
unsafe impl bytemuck::Zeroable for Nullifier {}

// this account prevents a second session from being verified with the same identity.
// it stores the session ID to ensure it cannot be lost.
#[account()]
pub struct NullifierV4 {
    pub session_id: Hash,
}
