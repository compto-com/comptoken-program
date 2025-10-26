use anchor_lang::prelude::*;

#[constant]
pub const MINT_DECIMALS: u8 = 2;

#[constant]
pub const LOCKED_MINT_SEED: &[u8] = b"locked_mint";

#[constant]
pub const UNLOCKED_MINT_SEED: &[u8] = b"unlocked_mint";

#[constant]
pub const GLOBAL_DATA_SEED: &[u8] = b"global_data";

#[constant]
// TODO: this number deserves scrutiny and justification
pub const COMPTOKEN_DISTRIBUTION_MULTIPLIER: u64 = 146_000;

#[constant]
pub const EARLY_ADOPTER_COUNT: u32 = 1_000_000_000;

#[constant]
pub const MIN_SUPPLY_LIMIT_AMT: u64 = 1_000_000;

#[constant]
// TODO: is there a better name for this?
// this value was chosen by roughly simulating the distribution and choosing a value that reasonably
// paces the distribution towards the end goal without being too aggressive
pub const ADJUST_FACTOR: f64 = 0.3;

#[constant]
// the target end daily max increase. this value achieves ~25% max increase over the course of a year. this value was chosen by taking
// the USD supply increase per year (~7%), and quadrupling it to allow for periods of larger growth, then rounding to a nicer number.
pub const END_GOAL_PERCENT_INCREASE: f64 = 0.00061;
