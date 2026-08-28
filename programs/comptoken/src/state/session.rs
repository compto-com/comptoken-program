use anchor_lang::prelude::*;

#[account()]
pub struct WorldIdV4Session {
    pub user_wallet: Pubkey,
}
