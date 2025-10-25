use anchor_lang::prelude::*;

#[constant]
pub const MINT_DECIMALS: u8 = 2;

#[constant]
pub const LOCKED_MINT_SEED: &[u8] = b"locked_mint";

#[constant]
pub const UNLOCKED_MINT_SEED: &[u8] = b"unlocked_mint";
