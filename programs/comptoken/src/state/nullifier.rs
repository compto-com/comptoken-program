use anchor_lang::prelude::*;

#[account(zero_copy)]
pub struct Nullifier {
    pub user_wallet: Pubkey,
}
