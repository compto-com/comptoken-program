use spl_token_2022::{
    extension::StateWithExtensions,
    solana_program::{account_info::AccountInfo, pubkey::Pubkey},
    state::Account,
};

use crate::generated::{
    COMPTOKEN_MINT_ADDRESS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, COMPTO_INTEREST_BANK_ACCOUNT_SEEDS,
    COMPTO_UBI_BANK_ACCOUNT_SEEDS, TRANSFER_HOOK_ID,
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
    account: &AccountInfo<'a>, wallet_owner: &VerifiedAccountInfo<'a>, needs_signer: bool, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    let account_data = &account.data.borrow();
    let wallet = StateWithExtensions::<Account>::unpack(account_data).expect("valid account state");
    assert!(*wallet_owner.key == wallet.base.owner);
    assert_eq!(wallet.base.mint, COMPTOKEN_MINT_ADDRESS);
    VerifiedAccountInfo::verify_account_signer_or_writable(account, needs_signer, needs_writable)
}

pub fn verify_user_data_account<'a>(
    user_data_account: &AccountInfo<'a>, user_comptoken_wallet_account: &VerifiedAccountInfo, program_id: &Pubkey,
    needs_writable: bool,
) -> (VerifiedAccountInfo<'a>, u8) {
    assert_eq!(user_data_account.owner, program_id);
    VerifiedAccountInfo::verify_pda(
        user_data_account,
        program_id,
        &[user_comptoken_wallet_account.key.as_ref()],
        false,
        needs_writable,
    )
}

pub fn verify_slothashes_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_sysvar::<solana_program::sysvar::slot_hashes::SlotHashes>(account)
}

pub fn verify_extra_account_metas_account<'a>(
    account: &AccountInfo<'a>, mint: &VerifiedAccountInfo<'a>, transfer_hook_program: &VerifiedAccountInfo<'a>,
) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda(
        account,
        transfer_hook_program.key,
        &[b"extra-account-metas", mint.key.as_ref()],
        false,
        false,
    )
    .0
}

pub fn verify_transfer_hook_program<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(account, &TRANSFER_HOOK_ID, false, false)
}
