use anchor_lang::prelude::*;

#[constant]
pub const MINT_DECIMALS: u8 = 2;

#[constant]
#[allow(clippy::inconsistent_digit_grouping)]
pub const MINING_REWARD_AMOUNT: u64 = 100_00; // 100.00 comptokens per proof

#[constant]
pub const STAKED_MINT_SEED: &[u8] = b"staked_mint";

#[constant]
pub const UNSTAKED_MINT_SEED: &[u8] = b"unstaked_mint";

#[constant]
pub const GLOBAL_DATA_SEED: &[u8] = b"global_data";

#[constant]
pub const USER_DATA_SEED: &[u8] = b"user_data";

#[constant]
pub const NULLIFIER_SEED: &[u8] = b"nullifier";

#[constant]
// TODO: this number deserves scrutiny and justification
pub const COMPTOKEN_DISTRIBUTION_MULTIPLIER: u64 = 146_000;

#[constant]
pub const EARLY_ADOPTER_COUNT: u32 = 1_000_000_000;

#[constant]
pub const MIN_SUPPLY_LIMIT_AMT: u64 = 1_000_000;

#[constant]
pub const PROOF_DIFFICULTY_NBITS: u32 = 0x180EADD8;

#[constant]
pub const PROOF_DIFFICULTY_NBITS_DEVNET: u32 = 0x1D0EADD8;

#[constant]
// TODO: is there a better name for this?
// this value was chosen by roughly simulating the distribution and choosing a value that reasonably
// paces the distribution towards the end goal without being too aggressive
// TODO: consider moving from floating point to integer arithmetic
pub const ADJUST_FACTOR: f64 = 0.3;

#[constant]
// the target end daily max increase. this value achieves ~25% max increase over the course of a year. this value was chosen by taking
// the USD supply increase per year (~7%), and quadrupling it to allow for periods of larger growth, then rounding to a nicer number.
// TODO: consider moving from floating point to integer arithmetic
pub const END_GOAL_PERCENT_INCREASE: f64 = 0.00061;

pub const SECONDS_IN_A_DAY: i64 = 86400;

#[constant]
pub const ANNOUNCEMENT_INTERVAL: i64 = 60 * 5; // 5 minutes

#[constant]
pub const VERIFICATION_DURATION: i64 = SECONDS_IN_A_DAY * 31; // 1 month (31 days)

#[constant]
pub const WORLD_ID_PROOF_LENGTH: u64 = 256;

pub const WORLD_ID_PROOF_SIZE: usize = 256;

#[constant]
pub const VERIFICATION_TYPE: &[u8; 1] = &[0]; // Query type verification (unsure what this actually means)

#[constant]
#[cfg(feature = "mainnet")]
pub const WORLD_APP_ID: &[u8] = b""; // TODO:;

#[constant]
#[cfg(feature = "devnet")]
pub const WORLD_APP_ID: &[u8] = b"app_staging_651f58cce60b3e824a4206cdcf3d4025"; // staging app id that allows cloud verifications (i.e. not orb based)

#[constant]
pub const WORLD_ACTION: &[u8] = b"verifyhuman";

// signals scope a proof to a specific instruction/account combination, so a proof cannot be
// replayed against a different instruction within world id's proof validity window.
#[constant]
pub const VERIFY_SIGNAL_ACTION: &[u8] = b"verify";

#[constant]
pub const REVERIFY_SIGNAL_ACTION: &[u8] = b"reverify";

#[constant]
pub const UNVERIFY_SIGNAL_ACTION: &[u8] = b"unverify";

// TODO: get correct values for v4

#[constant]
pub const WORLD_ID_V4_ACTION: &[u8] = b"verifyhuman-v4";

#[constant]
pub const WORLD_ID_V4_RP_ID: u64 = 1;

#[constant]
pub const WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN: u64 = 0; // unconstrained. TODO: do we want to constrain this? if so, what value should we use?

#[constant]
pub const WORLD_ID_V4_SESSION_SEED: &[u8] = b"world_id_session";
