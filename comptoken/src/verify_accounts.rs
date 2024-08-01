use std::ops::Deref;

use spl_token_2022::solana_program::{account_info::AccountInfo, pubkey::Pubkey};

use crate::generated::{
    COMPTOKEN_MINT_ADDRESS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, COMPTO_INTEREST_BANK_ACCOUNT_SEEDS,
    COMPTO_UBI_BANK_ACCOUNT_SEEDS,
};

#[derive(Debug, Clone)]
pub struct VerifiedAccountInfo<'a>(pub AccountInfo<'a>);

impl<'a> VerifiedAccountInfo<'a> {
    pub fn new(account: AccountInfo<'a>) -> Self {
        Self(account)
    }
}

impl<'a> Deref for VerifiedAccountInfo<'a> {
    type Target = AccountInfo<'a>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<'a> From<VerifiedAccountInfo<'a>> for AccountInfo<'a> {
    fn from(val: VerifiedAccountInfo<'a>) -> Self {
        val.0
    }
}

fn verify_account_signer_or_writable<'a>(
    account: &AccountInfo<'a>, needs_signer: bool, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    // only panic if signing/writing is needed and the account does not meet the requirements
    assert!(!needs_signer || account.is_signer);
    assert!(!needs_writable || account.is_writable);
    VerifiedAccountInfo::new(account.clone())
}

pub fn verify_payer_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    verify_account_signer_or_writable(account, true, true)
}

pub fn verify_comptoken_mint<'a>(account: &AccountInfo<'a>, needs_writable: bool) -> VerifiedAccountInfo<'a> {
    assert_eq!(*account.key, COMPTOKEN_MINT_ADDRESS);
    verify_account_signer_or_writable(account, false, needs_writable)
}

pub fn verify_global_data_account<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    let result = Pubkey::create_program_address(COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, program_id).unwrap();
    assert_eq!(*account.key, result);
    verify_account_signer_or_writable(account, false, needs_writable)
}

pub fn verify_interest_bank_account<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    let result = Pubkey::create_program_address(COMPTO_INTEREST_BANK_ACCOUNT_SEEDS, program_id).unwrap();
    assert_eq!(*account.key, result);
    verify_account_signer_or_writable(account, false, needs_writable)
}

pub fn verify_ubi_bank_account<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    let result = Pubkey::create_program_address(COMPTO_UBI_BANK_ACCOUNT_SEEDS, program_id).unwrap();
    assert_eq!(*account.key, result);
    verify_account_signer_or_writable(account, false, needs_writable)
}

pub fn verify_user_comptoken_wallet_account<'a>(
    account: &AccountInfo<'a>, needs_signer: bool, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    // TODO: verify comptoken user wallet accounts
    verify_account_signer_or_writable(account, needs_signer, needs_writable)
}

pub fn verify_user_data_account<'a>(
    user_data_account: &AccountInfo<'a>, user_comptoken_wallet_account: &VerifiedAccountInfo, program_id: &Pubkey,
    needs_writable: bool,
) -> (VerifiedAccountInfo<'a>, u8) {
    let (pda, bump) = Pubkey::find_program_address(&[user_comptoken_wallet_account.key.as_ref()], program_id);
    assert_eq!(*user_data_account.key, pda, "Invalid user data account");
    (verify_account_signer_or_writable(user_data_account, false, needs_writable), bump)
}

pub fn verify_slothashes_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    assert!(solana_program::sysvar::slot_hashes::check_id(account.key));
    VerifiedAccountInfo::new(account.clone())
}
