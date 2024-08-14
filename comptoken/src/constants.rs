// TODO: This number deserves scrutiny and justification.
pub const COMPTOKEN_DISTRIBUTION_MULTIPLIER: u64 = 146_000;

// The minimum supply to start limiting the high water mark
pub const MIN_SUPPLY_LIMIT_AMT: u64 = 1_000_000;

// TODO is there a better name for this?
// the power we raise the supply to in order find the max allowable High Wate Mark increase
pub const ADJUST_FACTOR: f64 = 0.3;

// the target end daily max increase. this value achieves ~25% max increase over the course of a year. this value was chosen by taking
// the USD supply increase per year (~7%), and quadrupling it to allow for periods of larger growth, then rounding to a nicer number.
pub const END_GOAL_PERCENT_INCREASE: f64 = 0.00061;

// seconds between earliest possible announcement and switchover point, currently 5 mins
pub const ANNOUNCEMENT_INTERVAL: i64 = 60 * 5;

// MAGIC NUMBER: ensure this remains consistent with full_deploy_test.py
pub const MINT_DECIMALS: u8 = 0;

// the bytes a comptoken account takes up
pub const COMPTOKEN_ACCOUNT_SPACE: u64 = 256; // TODO: get actual size

// the number of verified humans that will receive money from the future UBI account
pub const FUTURE_UBI_VERIFIED_HUMANS: u64 = 1_000_000_000;
