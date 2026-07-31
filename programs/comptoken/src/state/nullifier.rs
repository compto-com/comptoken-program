use anchor_lang::prelude::*;

#[account(zero_copy)]
pub struct Nullifier {
    pub user_wallet: Pubkey,
}

// TODO: can nullifiers be removed in v4? they are only useful to prevent an attacker from reusing a proof to unverify a user,
// (or verify them again after they unverify). trying to use the same proof to verify a second account will fail b/c the
// session_id will be in use and proofs are only valid for a short period of time so reverification is not a concern
// I believe this attack can be prevented by using a different signal for the different functions and therefore making each
// proof unique to the function.

#[account()]
pub struct NullifierV4 {}
