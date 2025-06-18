use solana_program::{
    account_info::{next_account_info, AccountInfo},
    hash::Hash,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use spl_token_2022::{extension::StateWithExtensions, state::Account};

use crate::{
    constants::{SOLANA_WORLD_ID_PROGRAM, WORLD_VERIFICATION_TYPE},
    generated::{
        COMPTOKEN_MINT_ADDRESS, COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS,
        COMPTO_INTEREST_BANK_ACCOUNT_SEEDS, COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS, TRANSFER_HOOK_ID,
    },
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
    account: &AccountInfo<'a>, wallet_owner_opt: Option<&VerifiedAccountInfo<'a>>, needs_writable: bool,
) -> VerifiedAccountInfo<'a> {
    let account_data = &account.data.borrow();
    let wallet = StateWithExtensions::<Account>::unpack(account_data).expect("valid account state");
    if let Some(wallet_owner) = wallet_owner_opt {
        assert_eq!(wallet.base.owner, *wallet_owner.key);
    }
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

pub fn verify_world_id_program<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(account, &SOLANA_WORLD_ID_PROGRAM, false, false)
}

pub fn verify_world_id_root<'a>(account: &AccountInfo<'a>, root_hash: &Hash) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda(
        account,
        &SOLANA_WORLD_ID_PROGRAM,
        &[b"Root", root_hash.as_ref(), &WORLD_VERIFICATION_TYPE],
        false,
        false,
    )
    .0
}

pub fn verify_world_id_latest_root<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda(
        account,
        &SOLANA_WORLD_ID_PROGRAM,
        &[b"LatestRoot", &WORLD_VERIFICATION_TYPE],
        false,
        false,
    )
    .0
}

pub fn verify_world_id_config<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_pda(account, &SOLANA_WORLD_ID_PROGRAM, &[b"Config"], false, false).0
}

pub fn verify_world_id_nullifier<'a>(
    account: &AccountInfo<'a>, program_id: &Pubkey, nullifier_hash: &Hash,
) -> (VerifiedAccountInfo<'a>, u8) {
    VerifiedAccountInfo::verify_pda(account, program_id, &[b"Nullifier", nullifier_hash.as_ref()], false, false)
}

pub fn verify_solana_program<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(account, &solana_program::system_program::ID, false, false)
}

fn verify_solana_token_2022_program<'a>(account: &AccountInfo<'a>) -> VerifiedAccountInfo<'a> {
    VerifiedAccountInfo::verify_specific_address(account, &spl_token_2022::ID, false, false)
}

pub enum AccountMetaType {
    None,
    Signer,
    Writable,
    SignerAndWritable,
}

impl AccountMetaType {
    pub fn needs_signer(&self) -> bool {
        matches!(self, AccountMetaType::Signer | AccountMetaType::SignerAndWritable)
    }

    pub fn needs_writable(&self) -> bool {
        matches!(self, AccountMetaType::Writable | AccountMetaType::SignerAndWritable)
    }
}

#[rustfmt::skip]
#[derive(Default)]
pub struct AccountsToVerify<'a> {
    pub payer:                                       Option<AccountMetaType>,
    pub comptoken_program:                           Option<AccountMetaType>,
    pub comptoken_mint:                              Option<AccountMetaType>,
    pub global_data_account:                         Option<AccountMetaType>,
    pub unpaid_interest_bank:                        Option<AccountMetaType>,
    pub unpaid_verified_human_ubi_bank:              Option<AccountMetaType>,
    pub unpaid_future_ubi_bank:                      Option<AccountMetaType>,
    pub unpaid_interest_bank_data_account:           Option<AccountMetaType>,
    pub unpaid_verified_human_ubi_bank_data_account: Option<AccountMetaType>,
    pub unpaid_future_ubi_bank_data_account:         Option<AccountMetaType>,
    pub user_wallet:                                 Option<AccountMetaType>,
    /// (check_owner, AccountMetaType)
    pub user_comptoken_token_account:                Option<(bool, AccountMetaType)>,
    /// (is_created, AccountMetaType)
    pub user_data_account:                           Option<(bool, AccountMetaType)>,
    pub transfer_hook_program:                       Option<AccountMetaType>,
    pub extra_account_metas:                         Option<AccountMetaType>,
    pub world_id_program:                            Option<AccountMetaType>,
    /// (root_hash, AccountMetaType)
    pub world_id_root:                               Option<(&'a Hash, AccountMetaType)>,
    pub world_id_latest_root:                        Option<AccountMetaType>,
    pub world_id_config:                             Option<AccountMetaType>,
    /// (nullifier_hash, AccountMetaType)
    pub world_id_nullifier:                          Option<(&'a Hash, AccountMetaType)>,
    pub solana_program:                              Option<AccountMetaType>,
    pub solana_token_2022_program:                   Option<AccountMetaType>,
    pub slothashes:                                  Option<AccountMetaType>,
}

#[rustfmt::skip]
pub struct VerifiedAccounts<'a> {
    pub payer:                                       Option<VerifiedAccountInfo<'a>>,
    pub comptoken_program:                           Option<VerifiedAccountInfo<'a>>,
    pub comptoken_mint:                              Option<VerifiedAccountInfo<'a>>,
    pub global_data_account:                         Option<VerifiedAccountInfo<'a>>,
    pub unpaid_interest_bank:                        Option<VerifiedAccountInfo<'a>>,
    pub unpaid_verified_human_ubi_bank:              Option<VerifiedAccountInfo<'a>>,
    pub unpaid_future_ubi_bank:                      Option<VerifiedAccountInfo<'a>>,
    pub unpaid_interest_bank_data_account:           Option<VerifiedAccountInfo<'a>>,
    pub unpaid_verified_human_ubi_bank_data_account: Option<VerifiedAccountInfo<'a>>,
    pub unpaid_future_ubi_bank_data_account:         Option<VerifiedAccountInfo<'a>>,
    pub user_wallet:                                 Option<VerifiedAccountInfo<'a>>,
    pub user_comptoken_token_account:                Option<VerifiedAccountInfo<'a>>,
    pub user_data_account:                           Option<VerifiedAccountInfo<'a>>,
    pub user_data_account_bump:                      Option<u8>,
    pub transfer_hook_program:                       Option<VerifiedAccountInfo<'a>>,
    pub extra_account_metas:                         Option<VerifiedAccountInfo<'a>>,
    pub world_id_program:                            Option<VerifiedAccountInfo<'a>>,
    pub world_id_root:                               Option<VerifiedAccountInfo<'a>>,
    pub world_id_latest_root:                        Option<VerifiedAccountInfo<'a>>,
    pub world_id_config:                             Option<VerifiedAccountInfo<'a>>,
    pub world_id_nullifier:                          Option<VerifiedAccountInfo<'a>>,
    pub world_id_nullifier_bump:                     Option<u8>,
    pub solana_program:                              Option<VerifiedAccountInfo<'a>>,
    pub solana_token_2022_program:                   Option<VerifiedAccountInfo<'a>>,
    pub slothashes:                                  Option<VerifiedAccountInfo<'a>>,
}

pub fn verify_accounts<'a>(
    accounts: &[AccountInfo<'a>], program_id: &Pubkey, accounts_to_verify: AccountsToVerify,
) -> Result<VerifiedAccounts<'a>, ProgramError> {
    let account_info_iter = &mut accounts.iter();
    let payer = accounts_to_verify
        .payer
        .map(|_| verify_payer_account(next_account_info(account_info_iter).unwrap()));

    let comptoken_program = accounts_to_verify.comptoken_program.map(|account_meta_type| {
        VerifiedAccountInfo::verify_specific_address(
            next_account_info(account_info_iter).unwrap(),
            program_id,
            account_meta_type.needs_signer(),
            account_meta_type.needs_writable(),
        )
    });
    let comptoken_mint = accounts_to_verify.comptoken_mint.map(|account_meta_type| {
        verify_comptoken_mint(next_account_info(account_info_iter).unwrap(), account_meta_type.needs_writable())
    });
    let global_data_account = accounts_to_verify.global_data_account.map(|account_meta_type| {
        verify_global_data_account(
            next_account_info(account_info_iter).unwrap(),
            program_id,
            account_meta_type.needs_writable(),
        )
    });

    let unpaid_interest_bank = accounts_to_verify.unpaid_interest_bank.map(|account_meta_type| {
        verify_interest_bank_account(
            next_account_info(account_info_iter).unwrap(),
            program_id,
            account_meta_type.needs_writable(),
        )
    });
    let unpaid_verified_human_ubi_bank = accounts_to_verify.unpaid_verified_human_ubi_bank.map(|account_meta_type| {
        verify_verified_human_ubi_bank_account(
            next_account_info(account_info_iter).unwrap(),
            program_id,
            account_meta_type.needs_writable(),
        )
    });
    let unpaid_future_ubi_bank = accounts_to_verify.unpaid_future_ubi_bank.map(|account_meta_type| {
        verify_future_ubi_bank_account(
            next_account_info(account_info_iter).unwrap(),
            program_id,
            account_meta_type.needs_writable(),
        )
    });

    let unpaid_interest_bank_data_account =
        accounts_to_verify.unpaid_interest_bank_data_account.map(|account_meta_type| {
            VerifiedAccountInfo::verify_pda(
                next_account_info(account_info_iter).unwrap(),
                program_id,
                &[unpaid_interest_bank.as_ref().unwrap().key.as_ref()],
                account_meta_type.needs_signer(),
                account_meta_type.needs_writable(),
            )
            .0
        });
    let unpaid_verified_human_ubi_bank_data_account =
        accounts_to_verify.unpaid_verified_human_ubi_bank_data_account.map(|account_meta_type| {
            VerifiedAccountInfo::verify_pda(
                next_account_info(account_info_iter).unwrap(),
                program_id,
                &[unpaid_verified_human_ubi_bank.as_ref().unwrap().key.as_ref()],
                account_meta_type.needs_signer(),
                account_meta_type.needs_writable(),
            )
            .0
        });
    let unpaid_future_ubi_bank_data_account =
        accounts_to_verify.unpaid_future_ubi_bank_data_account.map(|account_meta_type| {
            VerifiedAccountInfo::verify_pda(
                next_account_info(account_info_iter).unwrap(),
                program_id,
                &[unpaid_future_ubi_bank.as_ref().unwrap().key.as_ref()],
                account_meta_type.needs_signer(),
                account_meta_type.needs_writable(),
            )
            .0
        });

    let user_wallet = accounts_to_verify
        .user_wallet
        .map(|_| verify_wallet_account(next_account_info(account_info_iter).unwrap()));
    let user_comptoken_token_account =
        accounts_to_verify.user_comptoken_token_account.map(|(check_owner, account_meta_type)| {
            verify_user_comptoken_token_account(
                next_account_info(account_info_iter).unwrap(),
                if check_owner { Some(user_wallet.as_ref().unwrap()) } else { None },
                account_meta_type.needs_writable(),
            )
        });
    let (user_data, user_data_bump) = accounts_to_verify
        .user_data_account
        .map(|(is_created, account_meta_type)| {
            verify_user_data_account(
                next_account_info(account_info_iter).unwrap(),
                user_comptoken_token_account.as_ref().unwrap(),
                program_id,
                is_created,
                account_meta_type.needs_writable(),
            )
        })
        .unzip();

    let transfer_hook_program = accounts_to_verify
        .transfer_hook_program
        .map(|_| verify_transfer_hook_program(next_account_info(account_info_iter).unwrap()));
    let extra_account_metas = accounts_to_verify.extra_account_metas.map(|account_meta_type| {
        verify_extra_account_metas_account(
            next_account_info(account_info_iter).unwrap(),
            comptoken_mint.as_ref().unwrap(),
            transfer_hook_program.as_ref().unwrap(),
            account_meta_type.needs_writable(),
        )
    });

    let world_id_program = accounts_to_verify
        .world_id_program
        .map(|_| verify_world_id_program(next_account_info(account_info_iter).unwrap()));

    let world_id_root = accounts_to_verify
        .world_id_root
        .map(|(root_hash, _)| verify_world_id_root(next_account_info(account_info_iter).unwrap(), root_hash));

    let world_id_latest_root = accounts_to_verify
        .world_id_latest_root
        .map(|_| verify_world_id_latest_root(next_account_info(account_info_iter).unwrap()));

    let world_id_config = accounts_to_verify
        .world_id_config
        .map(|_| verify_world_id_config(next_account_info(account_info_iter).unwrap()));

    let (world_id_nullifier, world_id_nullifier_bump) = accounts_to_verify
        .world_id_nullifier
        .map(|(nullifier_hash, _)| {
            verify_world_id_nullifier(next_account_info(account_info_iter).unwrap(), program_id, nullifier_hash)
        })
        .unzip();

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
        global_data_account,
        unpaid_interest_bank,
        unpaid_verified_human_ubi_bank,
        unpaid_future_ubi_bank,
        unpaid_interest_bank_data_account,
        unpaid_verified_human_ubi_bank_data_account,
        unpaid_future_ubi_bank_data_account,
        user_wallet,
        user_comptoken_token_account,
        user_data_account: user_data,
        user_data_account_bump: user_data_bump,
        transfer_hook_program,
        extra_account_metas,
        world_id_program,
        world_id_root,
        world_id_latest_root,
        world_id_config,
        world_id_nullifier,
        world_id_nullifier_bump,
        solana_program,
        solana_token_2022_program,
        slothashes,
    })
}
