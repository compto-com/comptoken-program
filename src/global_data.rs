use solana_program::account_info::AccountInfo;
use solana_program::program_error::ProgramError;
use spl_token_2022::solana_program::hash::Hash;

#[repr(C)]
#[derive(Debug)]
pub struct GlobalData {
    pub valid_blockhash: Hash,
    pub announced_blockhash: Hash,
    pub old_supply: u64,
}

impl GlobalData {
    pub fn initialize(&mut self) {}
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
