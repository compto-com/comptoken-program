// full_deploy_test.py generates a comptoken_generated.rs
// The first build must not have the testmode feature enabled so that a ProgramId is created.
// full_deploy_test.py handles this case gracefully by building twice on the first usage.
#[cfg(feature = "testmode")]
mod comptoken_generated;
#[cfg(not(feature = "testmode"))]
mod comptoken_generated {
    use spl_token_2022::solana_program::{pubkey, pubkey::Pubkey};
    pub const COMPTOKEN_MINT_ADDRESS: Pubkey = pubkey!("11111111111111111111111111111111");
    pub const COMPTO_GLOBAL_DATA_ACCOUNT_BUMP: u8 = 255;
    pub const COMPTO_INTEREST_BANK_ACCOUNT_BUMP: u8 = 255;
    pub const COMPTO_UBI_BANK_ACCOUNT_BUMP: u8 = 255;
}
pub use comptoken_generated::{
    COMPTOKEN_MINT_ADDRESS, COMPTO_GLOBAL_DATA_ACCOUNT_BUMP,
    COMPTO_INTEREST_BANK_ACCOUNT_BUMP, COMPTO_UBI_BANK_ACCOUNT_BUMP,
};

pub const COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS: &[&[u8]] =
    &[b"Global Data", &[COMPTO_GLOBAL_DATA_ACCOUNT_BUMP]];
pub const COMPTO_INTEREST_BANK_ACCOUNT_SEEDS: &[&[u8]] =
    &[b"Interest Bank", &[COMPTO_INTEREST_BANK_ACCOUNT_BUMP]];
pub const COMPTO_UBI_BANK_ACCOUNT_SEEDS: &[&[u8]] = &[b"UBI Bank", &[COMPTO_UBI_BANK_ACCOUNT_BUMP]];
