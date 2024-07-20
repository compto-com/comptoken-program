use spl_token_2022::solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::generated::{
    COMPTOKEN_MINT_ADDRESS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, COMPTO_INTEREST_BANK_ACCOUNT_SEEDS,
    COMPTO_UBI_BANK_ACCOUNT_SEEDS,
};

fn verify_account_signer_or_writable(account: &AccountInfo, needs_signer: bool, needs_writable: bool) {
    // only panic if signing/writing is needed and the account does not meet the requirements
    assert!(!needs_signer || account.is_signer);
    assert!(!needs_writable || account.is_writable);
}

pub fn verify_payer_account(account: &AccountInfo) {
    verify_account_signer_or_writable(account, true, true);
}

pub fn verify_comptoken_mint(account: &AccountInfo, needs_writable: bool) {
    assert_eq!(*account.key, COMPTOKEN_MINT_ADDRESS);
    verify_account_signer_or_writable(account, false, needs_writable)
}

pub fn verify_global_data_account(account: &AccountInfo, program_id: &Pubkey, needs_writable: bool) -> Pubkey {
    let result = Pubkey::create_program_address(COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, program_id).unwrap();
    assert_eq!(*account.key, result);
    verify_account_signer_or_writable(account, false, needs_writable);
    result
}

pub fn verify_interest_bank_account(account: &AccountInfo, program_id: &Pubkey, needs_writable: bool) -> Pubkey {
    let result = Pubkey::create_program_address(COMPTO_INTEREST_BANK_ACCOUNT_SEEDS, program_id).unwrap();
    assert_eq!(*account.key, result);
    verify_account_signer_or_writable(account, false, needs_writable);
    result
}

pub fn verify_ubi_bank_account(account: &AccountInfo, program_id: &Pubkey, needs_writable: bool) -> Pubkey {
    let result = Pubkey::create_program_address(COMPTO_UBI_BANK_ACCOUNT_SEEDS, program_id).unwrap();
    assert_eq!(*account.key, result);
    verify_account_signer_or_writable(account, false, needs_writable);
    result
}

pub fn verify_user_comptoken_wallet_account(
    account: &AccountInfo, needs_signer: bool, needs_writable: bool,
) -> ProgramResult {
    // TODO: verify comptoken user wallet accounts
    verify_account_signer_or_writable(account, needs_signer, needs_writable);
    Ok(())
}

pub fn verify_user_data_account(
    user_data_account: &AccountInfo, user_comptoken_wallet_account: &AccountInfo, program_id: &Pubkey,
    needs_writable: bool,
) -> u8 {
    // if we ever need a user data account to sign something,
    // then we should return the bumpseed in this function
    let (pda, bump) = Pubkey::find_program_address(&[user_comptoken_wallet_account.key.as_ref()], program_id);
    assert_eq!(*user_data_account.key, pda, "Invalid user data account");
    verify_account_signer_or_writable(user_data_account, false, needs_writable);
    bump
}

pub fn verify_slothashes_account(slot_hashes_account: &AccountInfo) {
    assert!(solana_program::sysvar::slot_hashes::check_id(slot_hashes_account.key));
}
