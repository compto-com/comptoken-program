use spl_token_2022::solana_program::{account_info::AccountInfo, pubkey::Pubkey};

use crate::generated::{
    COMPTOKEN_MINT_ADDRESS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, COMPTO_INTEREST_BANK_ACCOUNT_SEEDS,
    COMPTO_UBI_BANK_ACCOUNT_SEEDS,
};

pub use comptoken_utils::verify_accounts::VerifiedAccountInfo;

pub fn verify_payer_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_account_signer_or_writable(account, true, true)
}

pub fn verify_comptoken_mint<'a>(account: &AccountInfo<'a>, needs_writable: bool) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(account, &COMPTOKEN_MINT_ADDRESS, false, needs_writable)
}

pub fn verify_global_data_account<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda_with_bump(
        account,
        program_id,
        COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS,
        false,
        needs_writable,
    )
}

pub fn verify_interest_bank_account<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda_with_bump(
        account,
        program_id,
        COMPTO_INTEREST_BANK_ACCOUNT_SEEDS,
        false,
        needs_writable,
    )
}

pub fn verify_ubi_bank_account<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda_with_bump(account, program_id, COMPTO_UBI_BANK_ACCOUNT_SEEDS, false, needs_writable)
}

pub fn verify_user_comptoken_wallet_account<'a>(
    account: &AccountInfo<'a>, needs_signer: bool, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    // TODO: verify comptoken user wallet accounts
    VerifiedAccountInfo::verify_account_signer_or_writable(account, needs_signer, needs_writable)
}

pub fn verify_user_data_account<'a>(
    user_data_account: &AccountInfo<'a>, user_comptoken_wallet_account: &VerifiedAccountInfo, program_id: &Pubkey,
    needs_writable: bool,
) -> (VerifiedAccountInfo<'a>, u8) {
    VerifiedAccountInfo::verify_pda(
        user_data_account,
        program_id,
        &[user_comptoken_wallet_account.key.as_ref()],
        false,
        needs_writable,
    )
}

pub fn verify_slothashes_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    assert!(solana_program::sysvar::slot_hashes::check_id(account.key));
    VerifiedAccountInfo::verify_sysvar::<solana_program::sysvar::slot_hashes::SlotHashes>(account)
}
