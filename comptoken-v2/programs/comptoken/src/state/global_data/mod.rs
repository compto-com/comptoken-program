pub mod daily_distribution_data;

pub use daily_distribution_data::*;

use anchor_lang::prelude::*;

#[account]
pub struct GlobalData {
    pub daily_distribution: DailyDistributionData,
}
