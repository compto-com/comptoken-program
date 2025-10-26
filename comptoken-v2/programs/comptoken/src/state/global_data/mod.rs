pub mod daily_distribution_data;

pub use daily_distribution_data::*;

use anchor_lang::prelude::*;

#[account]
pub struct GlobalData {
    pub daily_distribution: DailyDistributionData,
}

impl GlobalData {
    pub fn daily_distribution(&mut self, locked_supply: u64, unlocked_supply: u64) -> DailyDistribution {
        self.daily_distribution.daily_distribution(locked_supply, unlocked_supply)
    }

    pub fn init(&mut self) {
        self.daily_distribution.init();
    }
}
