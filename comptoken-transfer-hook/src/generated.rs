// common.py generates a comptoken_generated.rs
// The first build must not have the testmode feature enabled so that a ProgramId is created.
// full_deploy_test.py handles this case gracefully by building twice on the first usage.
#[cfg(feature = "testmode")]
mod comptoken_generated;
#[cfg(not(feature = "testmode"))]
mod comptoken_generated {
    use solana_program::{pubkey, pubkey::Pubkey};

    pub const COMPTOKEN_ID: Pubkey = pubkey!("11111111111111111111111111111111");

    pub const EXTRA_ACCOUNT_METAS_BUMP: u8 = 255;
    pub const MINT_ADDRESS: Pubkey = pubkey!("11111111111111111111111111111111");
}
pub use comptoken_generated::*;

pub const EXTRA_ACCOUNT_METAS_ACCOUNT_SEEDS: &[&[u8]] =
    &[b"extra-account-metas", &MINT_ADDRESS.to_bytes(), &[EXTRA_ACCOUNT_METAS_BUMP]];
