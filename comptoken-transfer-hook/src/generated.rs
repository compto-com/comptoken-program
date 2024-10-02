// common.py generates a comptoken_generated.rs
// The first build must not have the testmode feature enabled so that a ProgramId is created.
// full_deploy_test.py handles this case gracefully by building twice on the first usage.
#[cfg(feature = "testmode")]
mod comptoken_generated;
#[cfg(not(feature = "testmode"))]
mod comptoken_generated {
    use solana_program::{pubkey, pubkey::Pubkey};

    pub const COMPTOKEN_ID: Pubkey = pubkey!("6351sU4nPxMuxGNYNVK17DXC2fP2juh8YHfiMYCR7Zvh"); // devnet

    pub const EXTRA_ACCOUNT_METAS_BUMP: u8 = 251; // devnet
    pub const MINT_ADDRESS: Pubkey = pubkey!("76KRec9fujGWqdCuPzwiMgxFzQyYMSZa9HeySkbsyufV"); // devnet

    pub const COMPTO_INTEREST_BANK_ACCOUNT_PUBKEY: Pubkey = pubkey!("EaZvWXqhb6kX1rdZkr9yCBRcCTpnYwubSyhxrZtzcfhf"); // devnet
    pub const COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_PUBKEY: Pubkey =
        pubkey!("GoAPpRxCpRgVU6VCW3RAVf9fg4Jysuxt4PqSUpG3H9Xd"); // devnet
    pub const COMPTO_FUTURE_UBI_BANK_ACCOUNT_PUBKEY: Pubkey = pubkey!("2DXVGENSY9vTdozeFL888yPffC7nrakQAzdxSHanTHmN");
    // devnet
}
pub use comptoken_generated::*;

pub const EXTRA_ACCOUNT_METAS_ACCOUNT_SEEDS: &[&[u8]] =
    &[b"extra-account-metas", &MINT_ADDRESS.to_bytes(), &[EXTRA_ACCOUNT_METAS_BUMP]];
