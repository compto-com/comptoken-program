use anchor_lang::prelude::*;

declare_id!("9TMVfMJs6qyu8jnc7TJfAWhn81Ju2uSRj4uYqLHyKXnh");

pub use solana_world_id_program::{
    cpi,
    program::SolanaWorldIdProgram as WorldIdProgram,
    state::{Config as WorldIdConfig, LatestRoot as WorldIdLatestRoot, Root as WorldIdRoot},
};
pub const WORLD_ID_CONFIG_SEED: &[u8] = WorldIdConfig::SEED_PREFIX;
pub const WORLD_ID_LATEST_ROOT_SEED: &[u8] = WorldIdLatestRoot::SEED_PREFIX;
pub const WORLD_ID_ROOT_SEED: &[u8] = WorldIdRoot::SEED_PREFIX;
