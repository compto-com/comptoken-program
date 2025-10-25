use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;

/// Normalize to the start of the day (UTC)
pub fn normalize_time(timestamp: i64) -> i64 {
    const SECONDS_IN_A_DAY: i64 = 86400;
    timestamp - (timestamp % SECONDS_IN_A_DAY)
}

pub fn get_current_time() -> i64 {
    Clock::get().unwrap().unix_timestamp
}
