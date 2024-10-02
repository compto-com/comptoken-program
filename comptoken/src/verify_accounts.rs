use solana_program::msg;
use spl_token_2022::{
    extension::StateWithExtensions,
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        program_error::ProgramError,
        pubkey::Pubkey,
    },
    state::Account,
};

use crate::generated::{
    COMPTOKEN_MINT_ADDRESS, COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS,
    COMPTO_INTEREST_BANK_ACCOUNT_SEEDS, COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS, TRANSFER_HOOK_ID,
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

pub fn verify_verified_human_ubi_bank_account<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda_with_bump(
        account,
        program_id,
        COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS,
        false,
        needs_writable,
    )
}

pub fn verify_future_ubi_bank_account<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda_with_bump(
        account,
        program_id,
        COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS,
        false,
        needs_writable,
    )
}

pub fn verify_user_comptoken_token_account<'a>(
    account: &AccountInfo<'a>, wallet_owner: &VerifiedAccountInfo<'a>, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    // msg!("account.owner: {:?}", account.owner);
    // msg!("account.key: {:?}", account.key);
    let account_data = &account.data.borrow();
    // msg!("account_data: {:?}", account_data);
    let wallet = StateWithExtensions::<Account>::unpack(account_data).expect("valid account state");
    // msg!("wallet.base.owner: {:?}", wallet.base.owner);
    // msg!("wallet_owner.key: {:?}", wallet_owner.key);
    assert!(*wallet_owner.key == wallet.base.owner);
    assert_eq!(wallet.base.mint, COMPTOKEN_MINT_ADDRESS);
    VerifiedAccountInfo::verify_account_signer_or_writable(account, false, needs_writable)
}

pub fn verify_user_data_account<'a>(
    user_data_account: &AccountInfo<'a>, user_comptoken_wallet_account: &VerifiedAccountInfo, program_id: &Pubkey,
    is_created: bool, needs_writable: bool,
) -> (VerifiedAccountInfo<'a>, u8) {
    if is_created {
        assert_eq!(user_data_account.owner, program_id);
    }
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
    needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda(
        account,
        transfer_hook_program.key,
        &[b"extra-account-metas", mint.key.as_ref()],
        false,
        needs_writable,
    )
    .0
}

pub fn verify_wallet_account<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_account_signer_or_writable(account, true, false)
}

pub fn verify_transfer_hook_program<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(account, &TRANSFER_HOOK_ID, false, false)
}

pub fn verify_solana_program<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(
        account,
        &spl_token_2022::solana_program::system_program::ID,
        false,
        false,
    )
}

fn verify_solana_token_2022_program<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(account, &spl_token_2022::ID, false, false)
}

pub type SignerAndWritable = (bool, bool);

#[derive(Default)]
pub struct AccountsToVerify {
    pub payer: Option<SignerAndWritable>,
    pub comptoken_program: Option<SignerAndWritable>,
    pub comptoken_mint: Option<SignerAndWritable>,
    pub global_data: Option<SignerAndWritable>,
    pub interest_bank: Option<SignerAndWritable>,
    pub verified_human_ubi_bank: Option<SignerAndWritable>,
    pub future_ubi_bank: Option<SignerAndWritable>,
    pub interest_bank_data: Option<SignerAndWritable>,
    pub verified_human_ubi_bank_data: Option<SignerAndWritable>,
    pub future_ubi_bank_data: Option<SignerAndWritable>,
    pub user_wallet: Option<SignerAndWritable>,
    pub user_comptoken_token_account: Option<SignerAndWritable>,
    pub user_data: Option<(bool, SignerAndWritable)>, // (isCreated, (needsSigner, needsWritable)),
    pub transfer_hook_program: Option<SignerAndWritable>,
    pub extra_account_metas: Option<SignerAndWritable>,
    pub solana_program: Option<SignerAndWritable>,
    pub solana_token_2022_program: Option<SignerAndWritable>,
    pub slothashes: Option<SignerAndWritable>,
}

pub struct VerifiedAccounts<'a> {
    pub payer: Option<VerifiedAccountInfo<'a>>,
    pub comptoken_program: Option<VerifiedAccountInfo<'a>>,
    pub comptoken_mint: Option<VerifiedAccountInfo<'a>>,
    pub global_data: Option<VerifiedAccountInfo<'a>>,
    pub interest_bank: Option<VerifiedAccountInfo<'a>>,
    pub verified_human_ubi_bank: Option<VerifiedAccountInfo<'a>>,
    pub future_ubi_bank: Option<VerifiedAccountInfo<'a>>,
    pub interest_bank_data: Option<VerifiedAccountInfo<'a>>,
    pub verified_human_ubi_bank_data: Option<VerifiedAccountInfo<'a>>,
    pub future_ubi_bank_data: Option<VerifiedAccountInfo<'a>>,
    pub user_wallet: Option<VerifiedAccountInfo<'a>>,
    pub user_comptoken_token_account: Option<VerifiedAccountInfo<'a>>,
    pub user_data: Option<VerifiedAccountInfo<'a>>,
    pub user_data_bump: Option<u8>,
    pub transfer_hook_program: Option<VerifiedAccountInfo<'a>>,
    pub extra_account_metas: Option<VerifiedAccountInfo<'a>>,
    pub solana_program: Option<VerifiedAccountInfo<'a>>,
    pub solana_token_2022_program: Option<VerifiedAccountInfo<'a>>,
    pub slothashes: Option<VerifiedAccountInfo<'a>>,
}

pub fn verify_accounts<'a>(
    accounts: &[AccountInfo<'a>], program_id: &Pubkey, accounts_to_verify: AccountsToVerify,
) -> Result<VerifiedAccounts<'a>, ProgramError> {
    let account_info_iter = &mut accounts.iter();
    let payer = accounts_to_verify
        .payer
        .map(|_| verify_payer_account(next_account_info(account_info_iter).unwrap()));

    let comptoken_program = accounts_to_verify.comptoken_program.map(|(needs_signer, needs_writable)| {
        VerifiedAccountInfo::verify_specific_address(
            next_account_info(account_info_iter).unwrap(),
            program_id,
            needs_signer,
            needs_writable,
        )
    });
    let comptoken_mint = accounts_to_verify.comptoken_mint.map(|(_, needs_writable)| {
        verify_comptoken_mint(next_account_info(account_info_iter).unwrap(), needs_writable)
    });
    let global_data = accounts_to_verify.global_data.map(|(_, needs_writable)| {
        verify_global_data_account(next_account_info(account_info_iter).unwrap(), program_id, needs_writable)
    });

    let interest_bank = accounts_to_verify.interest_bank.map(|(_, needs_writable)| {
        verify_interest_bank_account(next_account_info(account_info_iter).unwrap(), program_id, needs_writable)
    });
    let verified_human_ubi_bank = accounts_to_verify.verified_human_ubi_bank.map(|(_, needs_writable)| {
        verify_verified_human_ubi_bank_account(
            next_account_info(account_info_iter).unwrap(),
            program_id,
            needs_writable,
        )
    });
    let future_ubi_bank = accounts_to_verify.future_ubi_bank.map(|(_, needs_writable)| {
        verify_future_ubi_bank_account(next_account_info(account_info_iter).unwrap(), program_id, needs_writable)
    });

    let interest_bank_data = accounts_to_verify.interest_bank_data.map(|(needs_signer, needs_writable)| {
        VerifiedAccountInfo::verify_pda(
            next_account_info(account_info_iter).unwrap(),
            program_id,
            &[interest_bank.as_ref().unwrap().key.as_ref()],
            needs_signer,
            needs_writable,
        )
        .0
    });
    let verified_human_ubi_bank_data =
        accounts_to_verify.verified_human_ubi_bank_data.map(|(needs_signer, needs_writable)| {
            VerifiedAccountInfo::verify_pda(
                next_account_info(account_info_iter).unwrap(),
                program_id,
                &[verified_human_ubi_bank.as_ref().unwrap().key.as_ref()],
                needs_signer,
                needs_writable,
            )
            .0
        });
    let future_ubi_bank_data = accounts_to_verify.future_ubi_bank_data.map(|(needs_signer, needs_writable)| {
        VerifiedAccountInfo::verify_pda(
            next_account_info(account_info_iter).unwrap(),
            program_id,
            &[future_ubi_bank.as_ref().unwrap().key.as_ref()],
            needs_signer,
            needs_writable,
        )
        .0
    });

    let user_wallet = accounts_to_verify
        .user_wallet
        .map(|_| verify_wallet_account(next_account_info(account_info_iter).unwrap()));
    let user_comptoken_token_account = accounts_to_verify.user_comptoken_token_account.map(|(_, needs_writable)| {
        verify_user_comptoken_token_account(
            next_account_info(account_info_iter).unwrap(),
            user_wallet.as_ref().unwrap(),
            needs_writable,
        )
    });
    let (user_data, user_data_bump) = accounts_to_verify
        .user_data
        .map(|(is_created, (_, needs_writable))| {
            verify_user_data_account(
                next_account_info(account_info_iter).unwrap(),
                user_comptoken_token_account.as_ref().unwrap(),
                program_id,
                is_created,
                needs_writable,
            )
        })
        .unzip();

    let transfer_hook_program = accounts_to_verify
        .transfer_hook_program
        .map(|_| verify_transfer_hook_program(next_account_info(account_info_iter).unwrap()));
    let extra_account_metas = accounts_to_verify.extra_account_metas.map(|(_, needs_writable)| {
        verify_extra_account_metas_account(
            next_account_info(account_info_iter).unwrap(),
            comptoken_mint.as_ref().unwrap(),
            transfer_hook_program.as_ref().unwrap(),
            needs_writable,
        )
    });

    let solana_program = accounts_to_verify
        .solana_program
        .map(|_| verify_solana_program(next_account_info(account_info_iter).unwrap()));
    let solana_token_2022_program = accounts_to_verify
        .solana_token_2022_program
        .map(|_| verify_solana_token_2022_program(next_account_info(account_info_iter).unwrap()));
    let slothashes = accounts_to_verify
        .slothashes
        .map(|_| verify_slothashes_account(next_account_info(account_info_iter).unwrap()));

    Ok(VerifiedAccounts {
        payer,
        comptoken_program,
        comptoken_mint,
        global_data,
        interest_bank,
        verified_human_ubi_bank,
        future_ubi_bank,
        interest_bank_data,
        verified_human_ubi_bank_data,
        future_ubi_bank_data,
        user_wallet,
        user_comptoken_token_account,
        user_data,
        user_data_bump,
        transfer_hook_program,
        extra_account_metas,
        solana_program,
        solana_token_2022_program,
        slothashes,
    })
}
