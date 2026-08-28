use anchor_lang::prelude::*;

use crate::state::hash::Hash;

#[account(zero_copy)]
pub struct Nullifier {
    pub user_wallet: Pubkey,
}

// this account prevents a second session from being verified with the same identity.
// it stores the session ID to ensure it cannot be lost.
#[account()]
pub struct NullifierV4 {
    pub session_id: Hash,
}
