mod daily_distribution_data;
pub mod valid_blockhashes;

use spl_token_2022::state::Mint;

use crate::VerifiedAccountInfo;
use daily_distribution_data::DailyDistributionData;
use valid_blockhashes::ValidBlockhashes;

#[repr(C)]
#[derive(Debug)]
pub struct GlobalData {
    pub valid_blockhashes: ValidBlockhashes,
    pub daily_distribution_data: DailyDistributionData,
}

pub struct DailyDistributionValues {
    pub interest_distributed: u64,
    pub ubi_distributed: u64,
}

impl GlobalData {
    pub fn initialize(&mut self, slot_hash_account: &VerifiedAccountInfo) {
        self.valid_blockhashes.initialize(slot_hash_account);
        self.daily_distribution_data.initialize();
    }

    pub fn daily_distribution_event(
        &mut self, mint: Mint, slot_hash_account: &VerifiedAccountInfo,
    ) -> DailyDistributionValues {
        self.valid_blockhashes.update(slot_hash_account);
        self.daily_distribution_data.daily_distribution(mint)
    }
}

impl<'a> From<&VerifiedAccountInfo<'a>> for &'a mut GlobalData {
    fn from(account: &VerifiedAccountInfo) -> Self {
        let mut data = account.try_borrow_mut_data().unwrap();
        let data = data.as_mut();

        assert!(
            data.len() >= std::mem::size_of::<GlobalData>(),
            "\n    note: left = `{}`\n    note: right = `{}`",
            data.len(),
            std::mem::size_of::<GlobalData>()
        );

        unsafe { &mut *(data as *mut _ as *mut GlobalData) }
    }
}
