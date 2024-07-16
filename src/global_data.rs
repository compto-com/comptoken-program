use spl_token_2022::{
    solana_program::{account_info::AccountInfo, hash::Hash, program_error::ProgramError},
    state::Mint,
};

use crate::constants::*;

#[repr(C)]
#[derive(Debug)]
pub struct GlobalData {
    pub valid_blockhash: Hash,
    pub announced_blockhash: Hash,
    pub yesterday_supply: u64,
    pub high_water_mark: u64,
    pub oldest_interest: usize,
    pub historic_interests: [f64; 365],
}

pub struct DailyDistributionValues {
    pub interest_distributed: u64,
    pub ubi_distributed: u64,
}

impl GlobalData {
    pub fn initialize(&mut self) {}

    pub fn daily_distribution_event(&mut self, mint: Mint) -> DailyDistributionValues {
        self.valid_blockhash = self.announced_blockhash;

        // calculate interest/high water mark
        let daily_mining_total = mint.supply - self.yesterday_supply;
        let high_water_mark_increase = self.calculate_high_water_mark_increase(daily_mining_total);
        self.high_water_mark += high_water_mark_increase;

        let total_daily_distribution = high_water_mark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER;
        let distribution_values = DailyDistributionValues {
            interest_distributed: total_daily_distribution / 2,
            ubi_distributed: total_daily_distribution / 2,
        };
        self.yesterday_supply =
            mint.supply + distribution_values.interest_distributed + distribution_values.ubi_distributed;

        let interest = distribution_values.interest_distributed as f64 / self.yesterday_supply as f64;
        self.historic_interests[self.oldest_interest] = interest;

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
}

impl<'a> TryFrom<&AccountInfo<'a>> for &'a mut GlobalData {
    type Error = ProgramError;

    fn try_from(account: &AccountInfo) -> Result<Self, Self::Error> {
        // TODO safety checks
        let mut data = account.try_borrow_mut_data()?;
        let result = unsafe { &mut *(data.as_mut() as *mut _ as *mut GlobalData) };
        Ok(result)
    }
}

// rust implements round_ties_even in version 1.77, which is more recent than
// the version (1.75) solana uses. this is a reimplementation, however rust's
// uses compiler intrinsics, so we can't just use their code
pub trait RoundEven {
    // not sure why it says this code is unused
    #[allow(dead_code)]
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
