pub mod daily_distribution_data;
pub mod valid_blockhashes;

use spl_token_2022::state::{Account, Mint};

use crate::VerifiedAccountInfo;
use daily_distribution_data::{DailyDistributionData, DailyDistributionValues};
use valid_blockhashes::ValidBlockhashes;

#[repr(C)]
#[derive(Debug)]
// MAGIC NUMBER: Changes to the size of this struct need to be reflected in test_client.js
pub struct GlobalData {
    pub valid_blockhashes: ValidBlockhashes,
    pub daily_distribution_data: DailyDistributionData,
}

impl GlobalData {
    pub fn initialize(&mut self, slot_hash_account: &VerifiedAccountInfo) {
        self.valid_blockhashes.initialize(slot_hash_account);
        self.daily_distribution_data.initialize();
    }

    pub fn daily_distribution_event(
        &mut self, mint: &Mint, unpaid_future_ubi_bank: &Account, slothashes_account: &VerifiedAccountInfo,
    ) -> DailyDistributionValues {
        self.valid_blockhashes.update(slothashes_account);
        self.daily_distribution_data.daily_distribution(mint, unpaid_future_ubi_bank)
    }
}

impl<'a> From<&VerifiedAccountInfo<'a>> for &'a mut GlobalData {
    fn from(account: &VerifiedAccountInfo) -> Self {
        let mut data = account.try_borrow_mut_data().unwrap();
        let data = data.as_mut();

        data.into()
    }
}

impl From<&mut [u8]> for &mut GlobalData {
    fn from(value: &mut [u8]) -> Self {
        assert!(
            value.len() >= std::mem::size_of::<GlobalData>(),
            "\n    note: left = `{}`\n    note: right = `{}`",
            value.len(),
            std::mem::size_of::<GlobalData>()
        );

        unsafe { &mut *(value as *mut _ as *mut GlobalData) }
    }
}
