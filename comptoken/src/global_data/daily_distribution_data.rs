use spl_token_2022::{
    solana_program::msg,
    state::{Account, Mint},
};

use crate::{constants::*, get_current_time, normalize_time};

const HISTORY_SIZE: usize = 365;

#[repr(C)]
#[derive(Debug)]
pub struct DailyDistributionData {
    pub yesterday_supply: u64,
    pub high_water_mark: u64,
    pub last_daily_distribution_time: i64,
    pub verified_humans: u64,
    pub oldest_historic_index: usize,
    pub historic_distributions: [(f64, u64); HISTORY_SIZE],
}

impl DailyDistributionData {
    const HISTORY_SIZE: usize = HISTORY_SIZE;

    pub(super) fn initialize(&mut self) {
        self.last_daily_distribution_time = normalize_time(get_current_time());
    }

    pub(super) fn daily_distribution(&mut self, mint: &Mint, future_ubi_bank: &Account) -> DailyDistributionValues {
        // calculate interest/high water mark
        self.last_daily_distribution_time = normalize_time(get_current_time());

        let daily_mining_total = mint.supply - self.yesterday_supply;
        if daily_mining_total == 0 {
            self.insert(1., 0);
            return DailyDistributionValues {
                interest_distribution: 0,
                ubi_for_verified_humans: 0,
                future_ubi_distribution: 0,
            };
        }
        let high_water_mark_increase = self.calculate_high_water_mark_increase(daily_mining_total);
        msg!("High water mark increase: {}", high_water_mark_increase);
        self.high_water_mark += high_water_mark_increase;
        let total_daily_distribution = high_water_mark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER;
        msg!("Total daily distribution: {}", total_daily_distribution);
        let total_ubi_distribution = total_daily_distribution / 2;
        let verified_human_ubi_ratio = f64::min(
            1.,
            self.verified_humans as f64 * 2. / (FUTURE_UBI_VERIFIED_HUMANS as f64 + self.verified_humans as f64),
        );
        msg!("Verified human UBI ratio: {}", verified_human_ubi_ratio);
        let mut distribution_values = DailyDistributionValues {
            interest_distribution: total_daily_distribution / 2,
            ubi_for_verified_humans: (total_ubi_distribution as f64 * verified_human_ubi_ratio) as u64,
            future_ubi_distribution: (total_ubi_distribution as f64 * (1. - verified_human_ubi_ratio)) as u64,
        };
        let todays_interest_rate = distribution_values.interest_distribution as f64 / mint.supply as f64;
        msg!("Interest: {}", todays_interest_rate);
        // pay out interest on comptokens in the unclaimed ubi bank
        // interest for the ubi for verified humans is calculated when the owed comptokens are payed out
        let future_ubi_interest = (future_ubi_bank.amount as f64 * todays_interest_rate).round_ties_even() as u64;
        distribution_values.interest_distribution =
            distribution_values.interest_distribution.saturating_sub(future_ubi_interest);
        distribution_values.future_ubi_distribution += future_ubi_interest;
        let todays_ubi = distribution_values.ubi_for_verified_humans.checked_div(self.verified_humans).unwrap_or(0);
        msg!("UBI: {}", todays_ubi);
        self.insert(1. + todays_interest_rate, todays_ubi);
        self.yesterday_supply = mint.supply + distribution_values.total_distributed();
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
        // the function (x - M)^(-a) + E was found to give what we felt were reasonable values for limits on the maximum growth
        let x = supply - MIN_SUPPLY_LIMIT_AMT;
        f64::powf(x as f64, -ADJUST_FACTOR) + END_GOAL_PERCENT_INCREASE
    }

    #[allow(unstable_name_collisions)]
    fn calculate_max_allowable_hwm_increase(supply: u64) -> u64 {
        // `as` casts are lossy, but it shouldn't matter in the ranges we are dealing with
        let max_increase = (supply as f64 * Self::calculate_distribution_limiter(supply)).round_ties_even() as u64
            / COMPTOKEN_DISTRIBUTION_MULTIPLIER;
        // cannot have a max increase of 0
        std::cmp::max(max_increase, 1)
    }

    pub fn get_interest_for_n_days(&self, n: usize, initial_money: u64) -> u64 {
        let new_balance = self
            .into_iter()
            .skip(Self::HISTORY_SIZE - n)
            .fold(initial_money as f64, |balance, (interest_rate, _)| (balance * interest_rate).round_ties_even())
            as u64;
        new_balance.saturating_sub(initial_money)
    }

    // we calculate and return ubi separately so that we know how much to distribute from the ubi vs interest banks
    // return value is (interest, ubi)
    pub fn get_distributions_for_n_days(&self, n: usize, initial_money: u64) -> (u64, u64) {
        let (new_balance, ubi) = self.into_iter().skip(Self::HISTORY_SIZE - n).fold(
            (initial_money as f64, 0),
            |(balance, ubi), (interest_rate, days_ubi)| {
                ((balance * interest_rate).round_ties_even() + days_ubi as f64, ubi + days_ubi)
            },
        );
        let interest = (new_balance as u64).saturating_sub(initial_money + ubi);
        (interest, ubi)
    }

    fn insert(&mut self, interest: f64, ubi: u64) {
        self.historic_distributions[self.oldest_historic_index] = (interest, ubi);
        self.oldest_historic_index += 1;
        self.oldest_historic_index %= Self::HISTORY_SIZE;
    }
}

pub struct DailyDistributionDataIter<'a> {
    index: usize,
    count: usize,
    daily_distribution_data: &'a DailyDistributionData,
}

impl<'a> Iterator for DailyDistributionDataIter<'a> {
    type Item = (f64, u64);

    fn next(&mut self) -> Option<Self::Item> {
        let result = if self.count >= DailyDistributionData::HISTORY_SIZE {
            None
        } else {
            Some(self.daily_distribution_data.historic_distributions[self.index])
        };

        self.count += 1;
        self.index += 1;
        self.index %= DailyDistributionData::HISTORY_SIZE;
        result
    }

    fn nth(&mut self, n: usize) -> Option<Self::Item> {
        self.count += n;
        self.index += n;
        self.index %= DailyDistributionData::HISTORY_SIZE;
        self.next()
    }
}

impl<'a> IntoIterator for &'a DailyDistributionData {
    type IntoIter = DailyDistributionDataIter<'a>;
    type Item = (f64, u64);

    fn into_iter(self) -> Self::IntoIter {
        DailyDistributionDataIter {
            index: self.oldest_historic_index,
            count: 0,
            daily_distribution_data: self,
        }
    }
}

pub struct DailyDistributionValues {
    pub interest_distribution: u64,
    pub ubi_for_verified_humans: u64,
    pub future_ubi_distribution: u64,
}

impl DailyDistributionValues {
    pub fn total_distributed(&self) -> u64 {
        self.interest_distribution + self.ubi_for_verified_humans + self.future_ubi_distribution
    }
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

#[cfg(test)]
mod test {
    use spl_token_2022::solana_program::pubkey::Pubkey;

    use super::*;

    #[test]
    fn test_round_ties_even() {
        assert_eq!(1.5.round_ties_even(), 2.);
        assert_eq!(2.5.round_ties_even(), 2.);
        assert_eq!(3.5.round_ties_even(), 4.);
        assert_eq!(4.5.round_ties_even(), 4.);
        assert_eq!(5.5.round_ties_even(), 6.);
        assert_eq!(6.5.round_ties_even(), 6.);
        assert_eq!(7.5.round_ties_even(), 8.);
        assert_eq!(8.5.round_ties_even(), 8.);
        assert_eq!(9.5.round_ties_even(), 10.);
        assert_eq!(10.5.round_ties_even(), 10.);
    }

    #[test]
    fn test_daily_distribution_data() {
        let mut data = DailyDistributionData {
            yesterday_supply: 0,
            high_water_mark: 0,
            last_daily_distribution_time: 0,
            verified_humans: 0,
            oldest_historic_index: 0,
            historic_distributions: [(0., 0); HISTORY_SIZE],
        };
        data.initialize();

        let mint = Mint {
            supply: 1,
            decimals: MINT_DECIMALS,
            is_initialized: true,
            ..Default::default()
        };
        let future_ubi_bank = Account { amount: 0, owner: Pubkey::new_unique(), ..Default::default() };
        let values = data.daily_distribution(&mint, &future_ubi_bank);

        assert_eq!(values.interest_distribution, 73_000);
        assert_eq!(values.ubi_for_verified_humans, 0);
        assert_eq!(values.future_ubi_distribution, 73_000);
        assert_eq!(data.yesterday_supply, 146_001);
        assert_eq!(data.high_water_mark, 1);
        assert_eq!(data.last_daily_distribution_time, normalize_time(get_current_time()));
    }

    #[test]
    fn test_daily_distribution_data_iter() {
        let mut data = DailyDistributionData {
            yesterday_supply: 0,
            high_water_mark: 0,
            last_daily_distribution_time: 0,
            verified_humans: 0,
            oldest_historic_index: 3,
            historic_distributions: [(0., 0); HISTORY_SIZE],
        };
        data.initialize();

        data.insert(1., 2);
        data.insert(3., 4);
        data.insert(5., 6);
        let mut iter = data.into_iter().skip(DailyDistributionData::HISTORY_SIZE - 3);
        assert_eq!(iter.next(), Some((1., 2)));
        assert_eq!(iter.next(), Some((3., 4)));
        assert_eq!(iter.next(), Some((5., 6)));
        assert_eq!(iter.next(), None);
    }
}
