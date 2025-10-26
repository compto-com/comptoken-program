pub mod daily_distribution_data;
pub mod valid_blockhashes;

pub use daily_distribution_data::*;
pub use valid_blockhashes::*;

use anchor_lang::prelude::*;

// account(zero_copy) impls bytemuck::Pod, which strictly speaking GlobalData
// should not be considered Pod, because it contains DailyDistributionData which
// contains a RingBuffer. however, we only use zero-copy deserialization, so it should be fine.
#[account(zero_copy)]
pub struct GlobalData {
    pub daily_distribution: DailyDistributionData,
    pub valid_blockhashes: ValidBlockhashes,
}

impl GlobalData {
    pub fn daily_distribution(&mut self, locked_supply: u64, unlocked_supply: u64) -> DailyDistribution {
        self.daily_distribution.daily_distribution(locked_supply, unlocked_supply)
    }

    pub fn init(&mut self, slot_hash_account: &UncheckedAccount<'_>) {
        self.daily_distribution.init();
        self.valid_blockhashes.init(slot_hash_account);
    }
}
