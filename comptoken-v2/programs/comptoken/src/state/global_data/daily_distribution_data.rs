use anchor_lang::prelude::*;

use crate::{
    helpers::{get_current_time, normalize_time},
    utils::ring_buffer::RingBuffer,
    ADJUST_FACTOR, COMPTOKEN_DISTRIBUTION_MULTIPLIER, EARLY_ADOPTER_COUNT, END_GOAL_PERCENT_INCREASE,
    MIN_SUPPLY_LIMIT_AMT,
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

impl DailyDistributionData {
    pub const HISTORY_SIZE: usize = HISTORY_SIZE;

    pub fn init(&mut self) {
        assert!(self.last_update_timestamp == 0); // ensure uninitialized
        *self = Self::default();
    }

    pub fn daily_distribution(&mut self, locked_supply: u64, unlocked_supply: u64) -> DailyDistribution {
        self.last_update_timestamp = normalize_time(get_current_time());

        if self.total_mined_today == 0 {
            self.historic_distributions.push(HistoricDistribution { yield_rate: 1., ubi_yield: 0 });
            return DailyDistribution { yield_amount: 0, ubi_amount: 0, early_adopter_ubi_amount: 0 };
        }

        let high_water_mark_increase = self.calculate_high_water_mark_increase(locked_supply + unlocked_supply);
        msg!("High water mark increase: {}", high_water_mark_increase);

        self.high_water_mark += high_water_mark_increase;

        let total_daily_distribution = high_water_mark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER;
        msg!("Total daily distribution: {}", total_daily_distribution);

        let total_ubi_distribution = total_daily_distribution / 2;
        let early_adopter_ubi_ratio = 1.
            - f64::min(
                1.,
                self.verified_accounts_count as f64 * 2.
                    / (EARLY_ADOPTER_COUNT as f64 + self.verified_accounts_count as f64),
            );
        msg!("Early adopter UBI ratio: {}", early_adopter_ubi_ratio);

        let ubi_for_early_adopters = (total_ubi_distribution as f64 * early_adopter_ubi_ratio).round_ties_even() as u64;
        let distribution = DailyDistribution {
            yield_amount: total_daily_distribution - total_ubi_distribution,
            ubi_amount: total_ubi_distribution - ubi_for_early_adopters,
            early_adopter_ubi_amount: ubi_for_early_adopters,
        };

        let todays_yield_rate = distribution.yield_amount as f64 / (locked_supply as f64);
        msg!("Today's yield rate: {}", todays_yield_rate);

        let todays_ubi_yield = distribution.ubi_amount.checked_div(self.verified_accounts_count as u64).unwrap_or(0);

        msg!("Today's UBI yield per verified account: {}", todays_ubi_yield);
        self.historic_distributions
            .push(HistoricDistribution { yield_rate: todays_yield_rate, ubi_yield: todays_ubi_yield });

        distribution
    }

    fn calculate_high_water_mark_increase(&self, total_supply: u64) -> u64 {
        // if daily_mining_total is less than the high water mark, `high_water_mark_uncapped_increase` will be 0
        let high_water_mark_uncapped_increase =
            std::cmp::max(self.high_water_mark, self.total_mined_today) - self.high_water_mark;
        // if the supply is small enough, the growth is uncapped
        if total_supply < MIN_SUPPLY_LIMIT_AMT {
            return high_water_mark_uncapped_increase;
        }
        let max_allowable_high_water_mark_increase = calculate_max_allowable_hwm_increase(total_supply);
        std::cmp::min(high_water_mark_uncapped_increase, max_allowable_high_water_mark_increase)
    }

    fn n_days_of_history(&self, n: usize) -> impl Iterator<Item = HistoricDistribution> + '_ {
        if n > self.historic_distributions.len() {
            msg!(
                "Requested {} days of history, but only {} days are available, truncating request.",
                n,
                self.historic_distributions.len()
            );
        }
        let n = n.min(self.historic_distributions.len());
        self.historic_distributions.into_iter().skip(self.historic_distributions.len() - n)
    }

    pub fn get_yield_for_n_days(&self, n: usize, principal: u64) -> u64 {
        // yield only applies to staked (locked) tokens, and they can't be staked until they are collected,
        // so we don't consider compounding here. calculations are done on a per-day basis to avoid incentivizing
        // gaming the rounding
        self.n_days_of_history(n)
            .map(|hd| hd.yield_rate)
            .map(|rate| (principal as f64 * rate).round_ties_even() as u64)
            .sum()
    }

    pub fn get_ubi_for_n_days(&self, n: usize) -> u64 {
        self.n_days_of_history(n).map(|hd| hd.ubi_yield).sum()
    }
}

fn calculate_max_allowable_hwm_increase(total_supply: u64) -> u64 {
    // `as` casts are lossy when u64 is > 2^53, but that should be safe here since supply will be smaller
    let max_increase = (total_supply as f64 * calculate_distribution_limiter(total_supply)).round_ties_even() as u64
        / COMPTOKEN_DISTRIBUTION_MULTIPLIER;
    // cannot have a max increase of 0
    std::cmp::max(max_increase, 1)
}

fn calculate_distribution_limiter(supply: u64) -> f64 {
    // exponential decay (x^(-a)) is used to limit distribution growth as supply increases,
    // but shifted to only apply after a certain supply threshold is met, and adjusted to asymptotically
    // approach a goal percent increase.
    // the final formula used to calculate the distribution limiter is:
    // limiter = (x - M)^(-a) + E
    // where:
    // M = minimum supply limit (supply threshold before which there is no limit)
    // a = adjust factor (controls the rate of decay)
    // E = end goal percent increase (the asymptotic limit as supply approaches infinity)
    let x = supply - MIN_SUPPLY_LIMIT_AMT;
    f64::powf(x as f64, -ADJUST_FACTOR) + END_GOAL_PERCENT_INCREASE
}
