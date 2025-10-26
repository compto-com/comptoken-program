use anchor_lang::prelude::*;

use crate::{
    helpers::{get_current_time, normalize_time},
    utils::ring_buffer::RingBuffer,
};

const HISTORY_SIZE: usize = 365;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct HistoricDistribution {
    pub yield_rate: f64,
    pub ubi_yield: u64,
}

#[derive(Clone)]
pub struct DailyDistribution {
    pub yield_amount: u64,
    pub ubi_amount: u64,
    pub early_adopter_ubi_amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DailyDistributionData {
    pub total_mined_today: u64,
    pub high_water_mark: u64,
    pub last_update_timestamp: i64,
    pub verified_accounts_count: u32,
    pub total_verified_balance: u64,
    pub historic_distributions: RingBuffer<HistoricDistribution, HISTORY_SIZE>,
}

impl Default for DailyDistributionData {
    fn default() -> Self {
        Self {
            total_mined_today: 0,
            high_water_mark: 0,
            last_update_timestamp: normalize_time(get_current_time()),
            verified_accounts_count: 0,
            total_verified_balance: 0,
            historic_distributions: RingBuffer::default(),
        }
    }
}
