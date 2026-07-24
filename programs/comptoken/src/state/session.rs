use anchor_lang::prelude::*;

#[account(zero_copy)]
pub struct WorldIdV4Session {
    pub user_wallet: Pubkey,
}
