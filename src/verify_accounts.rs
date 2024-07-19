use spl_token_2022::solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::generated::{
    COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, COMPTO_INTEREST_BANK_ACCOUNT_SEEDS, COMPTO_UBI_BANK_ACCOUNT_SEEDS,
};

pub fn verify_global_data_account(account: &AccountInfo, program_id: &Pubkey) -> Pubkey {
    let result = Pubkey::create_program_address(COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, program_id).unwrap();
    assert_eq!(*account.key, result);
    result
}

pub fn verify_interest_bank_account(account: &AccountInfo, program_id: &Pubkey) -> Pubkey {
    let result = Pubkey::create_program_address(COMPTO_INTEREST_BANK_ACCOUNT_SEEDS, program_id).unwrap();
    assert_eq!(*account.key, result);
    result
}

pub fn verify_ubi_bank_account(account: &AccountInfo, program_id: &Pubkey) -> Pubkey {
    let result = Pubkey::create_program_address(COMPTO_UBI_BANK_ACCOUNT_SEEDS, program_id).unwrap();
    assert_eq!(*account.key, result);
    result
}

pub fn verify_user_comptoken_wallet_account(_account: &AccountInfo) -> ProgramResult {
    // TODO: verify comptoken user accounts
    Ok(())
}

pub fn verify_comptoken_user_data_account(
    comptoken_user_data_account: &AccountInfo, comptoken_user_account: &AccountInfo, program_id: &Pubkey,
) -> u8 {
    // if we ever need a user data account to sign something,
    // then we should return the bumpseed in this function
    let (pda, bump) = Pubkey::find_program_address(&[comptoken_user_account.key.as_ref()], program_id);
    assert_eq!(*comptoken_user_data_account.key, pda, "Invalid user data account");
    bump
}

pub fn verify_slothashes_account(slot_hashes_account: &AccountInfo) {
    assert!(solana_program::sysvar::slot_hashes::check_id(slot_hashes_account.key));
}
