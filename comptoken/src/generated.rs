// common.py generates a comptoken_generated.rs
// The first build must not have the testmode feature enabled so that a ProgramId is created.
// full_deploy_test.py handles this case gracefully by building twice on the first usage.
#[cfg(feature = "testmode")]
mod comptoken_generated;
#[cfg(not(feature = "testmode"))]
mod comptoken_generated {
    use spl_token_2022::solana_program::{pubkey, pubkey::Pubkey};
    pub const COMPTOKEN_MINT_ADDRESS: Pubkey = pubkey!("76KRec9fujGWqdCuPzwiMgxFzQyYMSZa9HeySkbsyufV"); // devnet

    pub const TRANSFER_HOOK_ID: Pubkey = pubkey!("4GG3aGgaMXDKtrD9pMcmQ4P87pKKCKRxAxR4LGTKpmYt"); // devnet

    pub const COMPTO_GLOBAL_DATA_ACCOUNT_BUMP: u8 = 254; // devnet
    pub const COMPTO_INTEREST_BANK_ACCOUNT_BUMP: u8 = 252; // devnet
    pub const COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_BUMP: u8 = 253; // devnet
    pub const COMPTO_FUTURE_UBI_BANK_ACCOUNT_BUMP: u8 = 255; // devnet
}
pub use comptoken_generated::*;

pub const COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS: &[&[u8]] = &[b"Global Data", &[COMPTO_GLOBAL_DATA_ACCOUNT_BUMP]];
pub const COMPTO_INTEREST_BANK_ACCOUNT_SEEDS: &[&[u8]] = &[b"Interest Bank", &[COMPTO_INTEREST_BANK_ACCOUNT_BUMP]];
pub const COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS: &[&[u8]] =
    &[b"Verified Human UBI Bank", &[COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_BUMP]];
pub const COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS: &[&[u8]] =
    &[b"Future UBI Bank", &[COMPTO_FUTURE_UBI_BANK_ACCOUNT_BUMP]];
