use spl_token_2022::{
    extension::StateWithExtensions,
    solana_program::{account_info::AccountInfo, pubkey::Pubkey},
    state::Mint,
};

pub use comptoken_utils::verify_accounts::VerifiedAccountInfo;

use crate::generated::{COMPTOKEN_ID, EXTRA_ACCOUNT_METAS_ACCOUNT_SEEDS, MINT_ADDRESS};

pub fn verify_account_meta_storage_account<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda_with_bump(
        account,
        program_id,
        EXTRA_ACCOUNT_METAS_ACCOUNT_SEEDS,
        false,
        needs_writable,
    )
}

pub fn verify_mint_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    StateWithExtensions::<Mint>::unpack(&account.data.borrow()).unwrap(); // for the verification
    VerifiedAccountInfo::verify_account_signer_or_writable(account, false, false)
}

pub fn verify_comptoken_mint<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(account, &MINT_ADDRESS, true, false)
}

pub fn verify_mint_authority<'a>(
    account: &AccountInfo<'a>, mint: &VerifiedAccountInfo, needs_signer: bool, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    let data = mint.try_borrow_data().unwrap();
    let mint = StateWithExtensions::<Mint>::unpack(&data).unwrap();
    assert_eq!(*account.key, mint.base.mint_authority.expect("has a mint authority"));
    VerifiedAccountInfo::verify_account_signer_or_writable(account, needs_signer, needs_writable)
}

pub fn verify_source_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_account_signer_or_writable(account, false, false)
}

pub fn verify_destination_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_account_signer_or_writable(account, false, false)
}

pub fn verify_source_authority_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_account_signer_or_writable(account, false, false)
}

pub fn verify_comptoken_program<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(account, &COMPTOKEN_ID, false, false)
}

pub fn verify_user_data_account<'a>(
    account: &AccountInfo<'a>, user_account: &VerifiedAccountInfo<'a>,
) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda(account, &COMPTOKEN_ID, &[user_account.key.as_ref()], false, false).0
}
