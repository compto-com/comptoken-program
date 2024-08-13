use spl_token_2022::{solana_program::msg, state::Mint};

use crate::{constants::*, get_current_time, normalize_time};

const HISTORY_SIZE: usize = 365;

#[repr(C)]
#[derive(Debug)]
pub struct DailyDistributionData {
    pub yesterday_supply: u64,
    pub high_water_mark: u64,
    pub last_daily_distribution_time: i64,
    pub oldest_interest: usize,
    pub historic_interests: [f64; HISTORY_SIZE],
}

impl DailyDistributionData {
    const HISTORY_SIZE: usize = HISTORY_SIZE;

    pub(super) fn initialize(&mut self) {
        self.last_daily_distribution_time = normalize_time(get_current_time());
    }

    pub(super) fn daily_distribution(&mut self, mint: Mint) -> DailyDistributionValues {
        // calculate interest/high water mark
        self.last_daily_distribution_time = normalize_time(get_current_time());

        let daily_mining_total = mint.supply - self.yesterday_supply;
        if daily_mining_total == 0 {
            return DailyDistributionValues { interest_distributed: 0, ubi_distributed: 0 };
        }
        let high_water_mark_increase = self.calculate_high_water_mark_increase(daily_mining_total);
        msg!("High water mark increase: {}", high_water_mark_increase);
        self.high_water_mark += high_water_mark_increase;

        let total_daily_distribution = high_water_mark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER;
        let distribution_values = DailyDistributionValues {
            interest_distributed: total_daily_distribution / 2,
            ubi_distributed: total_daily_distribution / 2,
        };
        let interest = distribution_values.interest_distributed as f64 / mint.supply as f64;
        msg!("Interest: {}", interest);
        self.insert(interest);

        self.yesterday_supply =
            mint.supply + distribution_values.interest_distributed + distribution_values.ubi_distributed;

        distribution_values
    }

    fn calculate_high_water_mark_increase(&self, daily_mining_total: u64) -> u64 {
        // if daily_mining_total is less than the high water mark, `high_water_mark_uncapped_increase` will be 0
        let high_water_mark_uncapped_increase =
            std::cmp::max(self.high_water_mark, daily_mining_total) - self.high_water_mark;
        // if the supply is small enough, the growth is uncapped
        if self.yesterday_supply < MIN_SUPPLY_LIMIT_AMT {
            return high_water_mark_uncapped_increase;
        }
        let max_allowable_high_water_mark_increase = Self::calculate_max_allowable_hwm_increase(self.yesterday_supply);
        std::cmp::min(high_water_mark_uncapped_increase, max_allowable_high_water_mark_increase)
    }

    fn calculate_distribution_limiter(supply: u64) -> f64 {
        // the function (x - M)^a + E was found to give what we felt were reasonable values for limits on the maximum growth
        let x = supply - MIN_SUPPLY_LIMIT_AMT;
        f64::powf(x as f64, -ADJUST_FACTOR) + END_GOAL_PERCENT_INCREASE
    }

    #[allow(unstable_name_collisions)]
    fn calculate_max_allowable_hwm_increase(supply: u64) -> u64 {
        // `as` casts are lossy, but it shouldn't matter in the ranges we are dealing with
        (supply as f64 * Self::calculate_distribution_limiter(supply)).round_ties_even() as u64
            / COMPTOKEN_DISTRIBUTION_MULTIPLIER
    }

    pub fn apply_n_interests(&self, n: usize, initial_money: u64) -> u64 {
        self.into_iter()
            .take(n)
            .fold(initial_money as f64, |money, interest| (money * (1. + interest)).round_ties_even()) as u64
    }

    fn insert(&mut self, interest: f64) {
        self.historic_interests[self.oldest_interest] = interest;
        self.oldest_interest = (self.oldest_interest + 1) % Self::HISTORY_SIZE;
    }
}

pub struct DailyDistributionDataIter {
    iter: Box<dyn Iterator<Item = f64>>,
}

impl Iterator for DailyDistributionDataIter {
    type Item = f64;

    fn next(&mut self) -> Option<Self::Item> {
        self.iter.next()
    }
}

impl IntoIterator for &DailyDistributionData {
    type IntoIter = DailyDistributionDataIter;
    type Item = f64;

    fn into_iter(self) -> Self::IntoIter {
        DailyDistributionDataIter {
            iter: Box::from(
                self.historic_interests
                    .into_iter()
                    .rev()
                    .cycle()
                    .skip(DailyDistributionData::HISTORY_SIZE - self.oldest_interest)
                    .take(DailyDistributionData::HISTORY_SIZE),
            ),
        }
    }
}

pub struct DailyDistributionValues {
    pub interest_distributed: u64,
    pub ubi_distributed: u64,
}

// rust implements round_ties_even in version 1.77, which is more recent than
// the version (1.75) solana uses. this is a reimplementation, however rust's
// uses compiler intrinsics, so we can't just use their code
pub trait RoundEven {
    fn round_ties_even(self) -> Self;
}

impl RoundEven for f64 {
    fn round_ties_even(self) -> Self {
        let res = self.round();
        if (self - res).abs() == 0.5 && res % 2. != 0. {
            self.trunc()
        } else {
            res
        }
    }
}
