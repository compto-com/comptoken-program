use anchor_lang::prelude::*;

use crate::{
    constants::SECONDS_IN_A_DAY,
    helpers::{get_current_time, normalize_time},
    state::error::ComptokenError,
    utils::ring_buffer::RingBuffer,
    ADJUST_FACTOR, COMPTOKEN_DISTRIBUTION_MULTIPLIER, EARLY_ADOPTER_COUNT, END_GOAL_PERCENT_INCREASE,
    MIN_SUPPLY_LIMIT_AMT,
};

const HISTORY_LENGTH: usize = 365;

#[repr(C)]
#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, Default, bytemuck::Pod, bytemuck::Zeroable)]
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

// technically, because of the RingBuffer, this struct is not strictly Pod. see comment there
// however, we only use zero-copy deserialization, so it should be fine.
// the _padding field ensures there is no "padding" in the struct so that bytemuck::Pod can be derived.
#[repr(C)]
#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct DailyDistributionData {
    pub total_mined_today: u64,
    pub high_water_mark: u64,
    pub last_update_timestamp: i64,
    pub per_capita_early_adopter_ubi_amount: u64,
    pub verified_accounts_count: u32,
    pub remaining_early_adopter_count: u32,
    pub historic_distributions: RingBuffer<HistoricDistribution, HISTORY_LENGTH>,
}

impl Default for DailyDistributionData {
    fn default() -> Self {
        Self {
            total_mined_today: 0,
            high_water_mark: 0,
            last_update_timestamp: normalize_time(get_current_time()),
            verified_accounts_count: 0,
            per_capita_early_adopter_ubi_amount: 0,
            remaining_early_adopter_count: EARLY_ADOPTER_COUNT,
            historic_distributions: RingBuffer::default(),
        }
    }
}

impl DailyDistributionData {
    pub const HISTORY_LENGTH: usize = HISTORY_LENGTH;

    pub fn init(&mut self) -> Result<()> {
        require_eq!(self.last_update_timestamp, 0, ComptokenError::AccountAlreadyInitialized); // ensure uninitialized
        *self = Self::default();
        Ok(())
    }

    /// Calculates the daily distribution based on the current state and provided supplies,
    /// updates state accordingly, and returns the calculated distribution.
    /// assumes that this is only called once per day; behavior is undefined otherwise.
    pub fn daily_distribution(&mut self, staked_supply: u64, unstaked_supply: u64) -> DailyDistribution {
        if self.total_mined_today == 0 {
            self.finalize_day(HistoricDistribution { yield_rate: 0., ubi_yield: 0 });
            return DailyDistribution { yield_amount: 0, ubi_amount: 0, early_adopter_ubi_amount: 0 };
        }

        let high_water_mark_increase = self.calculate_high_water_mark_increase(staked_supply + unstaked_supply);
        msg!("High water mark increase: {}", high_water_mark_increase);

        self.high_water_mark += high_water_mark_increase;

        let total_daily_distribution = high_water_mark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER;
        msg!("Total daily distribution: {}", total_daily_distribution);

        let total_ubi_distribution = total_daily_distribution / 2;
        // when verified_accounts_count >= EARLY_ADOPTER_COUNT, early_adopter_ubi_ratio will be 0
        // otherwise, it scales so that a verified account gets ~twice as much UBI as is stored for (later) early adopters
        let early_adopter_ubi_ratio = EARLY_ADOPTER_COUNT.saturating_sub(self.verified_accounts_count) as f64
            / (EARLY_ADOPTER_COUNT + self.verified_accounts_count) as f64;

        msg!("Early adopter UBI ratio: {}", early_adopter_ubi_ratio);

        let ubi_for_early_adopters = (total_ubi_distribution as f64 * early_adopter_ubi_ratio).round_ties_even() as u64;
        let distribution = DailyDistribution {
            yield_amount: total_daily_distribution - total_ubi_distribution,
            ubi_amount: total_ubi_distribution - ubi_for_early_adopters,
            early_adopter_ubi_amount: ubi_for_early_adopters,
        };

        let todays_yield_rate =
            if staked_supply != 0 { distribution.yield_amount as f64 / staked_supply as f64 } else { 0. };
        msg!("Today's yield rate: {}", todays_yield_rate);

        let todays_ubi_yield = distribution.ubi_amount.checked_div(self.verified_accounts_count as u64).unwrap_or(0); // avoid div by 0, which means no verified accounts and all UBI goes to early adopters

        if self.remaining_early_adopter_count != 0 {
            // per capita early adopter UBI amount is cumulative and is used during claim to determine how much each
            // verified account is owed. this is ~%50 of what a verified-from-day-1 account would have gotten in UBI
            // not strictly necessary to only increment when there are remaining early adopters, but it avoids
            // unnecessary math
            self.per_capita_early_adopter_ubi_amount +=
                ubi_for_early_adopters / self.remaining_early_adopter_count as u64;
        }

        msg!("Today's UBI yield per verified account: {}", todays_ubi_yield);
        self.finalize_day(HistoricDistribution { yield_rate: todays_yield_rate, ubi_yield: todays_ubi_yield });

        distribution
    }

    // Finalizes the day by pushing the provided HistoricDistribution to history,
    // resetting total_mined_today, and updating last_update_timestamp. If days
    // have been missed, pushes zeroed HistoricDistributions for each missed day.
    fn finalize_day(&mut self, hd: HistoricDistribution) {
        self.historic_distributions.push(hd);
        self.total_mined_today = 0;
        let today = normalize_time(get_current_time());
        let days_missed = (today - self.last_update_timestamp) / SECONDS_IN_A_DAY - 1;
        if days_missed > 0 {
            msg!("Days missed since last update: {}", days_missed);
        }
        for _ in 0..days_missed {
            self.historic_distributions.push(HistoricDistribution { yield_rate: 0., ubi_yield: 0 });
        }
        self.last_update_timestamp = today;
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
        // yield only applies to staked tokens, and they can't be staked until they are collected,
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

#[constant]
pub const DAILY_DISTRIBUTION_DATA_HISTORY_LENGTH: u64 = DailyDistributionData::HISTORY_LENGTH as u64;
