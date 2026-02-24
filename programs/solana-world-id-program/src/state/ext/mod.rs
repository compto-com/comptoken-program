pub use anchor_lang::prelude::*;

cfg_if::cfg_if! {
    if #[cfg(all(feature = "mainnet", feature = "testnet"))] {
        compile_error!("Features 'mainnet' and 'testnet' are mutually exclusive.");
    } else if #[cfg(feature = "mainnet")] {
        pub const CORE_BRIDGE_PROGRAM_ID: Pubkey = pubkey!("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");
    } else if #[cfg(feature = "testnet")] {
        pub const CORE_BRIDGE_PROGRAM_ID: Pubkey = pubkey!("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5");
    } else {
        compile_error!("Either feature 'mainnet' or 'testnet' must be enabled.");
    }
}

// definition taken from Wormhole's core bridge program
// https://github.com/wormholelabs-xyz/wormhole/blob/main/solana/bridge/program/src/accounts/guardian_set.rs
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WormholeGuardianSet {
    /// Index representing an incrementing version number for this guardian set.
    pub index: u32,

    /// Ethereum-style public keys.
    pub keys: Vec<[u8; 20]>,

    /// Timestamp representing the time this guardian became active.
    pub creation_time: u32,

    /// Expiration time when VAAs issued by this set are no longer valid.
    pub expiration_time: u32,
}

// this account is a pda owned by the core bridge program, so the address must be derived accordingly
impl Owner for WormholeGuardianSet {
    fn owner() -> Pubkey {
        Pubkey::new_from_array(CORE_BRIDGE_PROGRAM_ID.to_bytes())
    }
}

// workaround for anchor 0.30.1
// https://github.com/coral-xyz/anchor/blob/e6d7dafe12da661a36ad1b4f3b5970e8986e5321/spl/src/idl_build.rs#L11
impl anchor_lang::Discriminator for WormholeGuardianSet {
    const DISCRIMINATOR: &'static [u8] = &[1, 0, 0, 0, 0, 0, 0, 0]; // any non-zero pattern
}

impl AccountSerialize for WormholeGuardianSet {}

impl AccountDeserialize for WormholeGuardianSet {
    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        Self::deserialize(buf).map_err(Into::into)
    }
}

impl WormholeGuardianSet {
    pub const SEED_PREFIX: &'static [u8] = b"GuardianSet";

    pub fn is_active(&self, timestamp: &u32) -> bool {
        // Note: This is a fix for Wormhole on mainnet.  The initial guardian set was never expired
        // so we block it here.
        if self.index == 0 && self.creation_time == 1628099186 {
            false
        } else {
            self.expiration_time == 0 || self.expiration_time >= *timestamp
        }
    }
}
