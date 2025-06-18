use comptoken_utils::verify_accounts::VerifiedAccountInfo;
use solana_program::pubkey::Pubkey;

pub struct Nullifier {
    pub account: Pubkey,
}

impl<'a> From<&VerifiedAccountInfo<'a>> for &'a mut Nullifier {
    fn from(account: &VerifiedAccountInfo) -> Self {
        let mut data = account.try_borrow_mut_data().unwrap();
        let data = data.as_mut();

        data.into()
    }
}

impl<'a> From<&VerifiedAccountInfo<'a>> for &'a Nullifier {
    fn from(account: &VerifiedAccountInfo) -> Self {
        let data = account.try_borrow_data().unwrap();
        let data = data.as_ref();

        data.into()
    }
}

impl From<&mut [u8]> for &mut Nullifier {
    fn from(value: &mut [u8]) -> Self {
        assert!(
            value.len() >= std::mem::size_of::<Nullifier>(),
            "\n    note: left = `{}`\n    note: right = `{}`",
            value.len(),
            std::mem::size_of::<Nullifier>()
        );

        unsafe { &mut *(value as *mut _ as *mut Nullifier) }
    }
}

impl From<&[u8]> for &Nullifier {
    fn from(value: &[u8]) -> Self {
        assert!(
            value.len() >= std::mem::size_of::<Nullifier>(),
            "\n    note: left = `{}`\n    note: right = `{}`",
            value.len(),
            std::mem::size_of::<Nullifier>()
        );

        unsafe { &*(value as *const _ as *const Nullifier) }
    }
}
