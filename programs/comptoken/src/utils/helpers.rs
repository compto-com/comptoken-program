use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;

use crate::SECONDS_IN_A_DAY;

/// Normalize to the start of the day (UTC)
pub fn normalize_time(timestamp: i64) -> i64 {
    timestamp - (timestamp % SECONDS_IN_A_DAY)
}

pub fn get_current_time() -> i64 {
    Clock::get().unwrap().unix_timestamp
}
