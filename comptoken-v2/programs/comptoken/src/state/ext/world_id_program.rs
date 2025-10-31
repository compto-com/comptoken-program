use anchor_lang::prelude::*;

declare_id!("9TMVfMJs6qyu8jnc7TJfAWhn81Ju2uSRj4uYqLHyKXnh");

declare_program!(solana_world_id_program);
pub use solana_world_id_program::{
    accounts::{Config as WorldIdConfig, LatestRoot as WorldIdLatestRoot, Root as WorldIdRoot},
    cpi,
    program::SolanaWorldIdProgram as WorldIdProgram,
};
pub const WORLD_ID_CONFIG_SEED: &[u8] = b"config";
pub const WORLD_ID_LATEST_ROOT_SEED: &[u8] = b"latest_root";
pub const WORLD_ID_ROOT_SEED: &[u8] = b"root";
