mod generated;
mod verify_accounts;

use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_token_2022::solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};

use comptoken_utils::{create_pda, user_data::UserData};

use generated::{
    COMPTOKEN_ID, COMPTO_INTEREST_BANK_ACCOUNT_PUBKEY, COMPTO_UBI_BANK_ACCOUNT_PUBKEY,
    EXTRA_ACCOUNT_METAS_ACCOUNT_SEEDS,
};
use verify_accounts::{
    verify_account_meta_storage_account, verify_comptoken_mint, verify_comptoken_program, verify_destination_account,
    verify_mint_account, verify_mint_authority, verify_source_account, verify_source_authority_account,
    verify_user_data_account, VerifiedAccountInfo,
};

entrypoint!(process_instruction);
pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    msg!("{:?}", instruction_data);
    match TransferHookInstruction::unpack(instruction_data)? {
        TransferHookInstruction::Execute { amount } => process_execute(program_id, accounts, amount),
        TransferHookInstruction::InitializeExtraAccountMetaList { extra_account_metas } => {
            process_initialize_extra_account_meta_list(program_id, accounts, extra_account_metas)
        }
        TransferHookInstruction::UpdateExtraAccountMetaList { extra_account_metas: _ } => {
            panic!("instruction not implemented");
        }
    }
}

fn process_execute(program_id: &Pubkey, accounts: &[AccountInfo], _amount: u64) -> ProgramResult {
    //  Accounts
    //      []: Source token account
    //      []: Mint
    //      []: Destination token account
    //      []: Source token account authority
    //      []: account meta storage account
    //      []: Comptoken Program
    //      []: Source Data Account
    //      []: Destination Data Account

    let account_info_iter = &mut accounts.iter();
    let source_account = verify_source_account(next_account_info(account_info_iter)?);
    // required as part of the transferhook API to identify that comptokens are being transferred
    let _comptoken_mint_account = verify_comptoken_mint(next_account_info(account_info_iter)?);
    let destination_account = verify_destination_account(next_account_info(account_info_iter)?);
    // also required as part of the transferhook API but we don't use
    let _source_account_authority = verify_source_authority_account(next_account_info(account_info_iter)?);
    // used by transferhook to get the comptoken program and the PDAs before it gets here
    let _account_meta_storage_account =
        verify_account_meta_storage_account(next_account_info(account_info_iter)?, program_id, false);
    // used by transferhook to generate the PDAs before it gets here
    let _comptoken_program = verify_comptoken_program(next_account_info(account_info_iter)?);
    let source_data_account = verify_user_data_account(next_account_info(account_info_iter)?, &source_account);
    let destination_data_account =
        verify_user_data_account(next_account_info(account_info_iter)?, &destination_account);

    // Account must either be a bank account or have no unpaid interest or UBI amounts to do a transfer
    if !is_bank(source_account.key) {
        let source_user_data: &UserData = (&source_data_account).into();
        assert!(source_user_data.is_current());
        if !is_bank(destination_account.key) {
            let destination_user_data: &UserData = (&destination_data_account).into();
            assert!(destination_user_data.is_current());
        }
    }
    Ok(())
}

fn process_initialize_extra_account_meta_list(
    program_id: &Pubkey, accounts: &[AccountInfo], _extra_account_metas: Vec<ExtraAccountMeta>,
) -> ProgramResult {
    //  Accounts
    //      [w]: account meta storage account
    //      []: Mint
    //      [s]: Mint authority
    //      []: System program
    //      [sw]: payer account (not part of the standard)

    let account_info_iter = &mut accounts.iter();
    let account_meta_storage_account = next_account_info(account_info_iter)?;
    let mint_account = next_account_info(account_info_iter)?;
    let mint_authority = next_account_info(account_info_iter)?;
    let _system_program = next_account_info(account_info_iter)?;
    let payer_account = next_account_info(account_info_iter)?;

    let mint_account = verify_mint_account(mint_account);
    let account_meta_storage_account =
        verify_account_meta_storage_account(account_meta_storage_account, program_id, true);
    let _mint_authority = verify_mint_authority(mint_authority, &mint_account, true, false);
    let payer_account = VerifiedAccountInfo::verify_account_signer_or_writable(payer_account, true, true);

    const SENDER_ACCOUNT_INDEX: u8 = 0;
    // mint = 1
    const RECEIVER_ACCOUNT_INDEX: u8 = 2;
    // sender account authority = 3
    // account meta storage account = 4
    const COMPTOKEN_PROGRAM_INDEX: u8 = 5;

    let account_metas = vec![
        // index: 5
        ExtraAccountMeta::new_with_pubkey(&COMPTOKEN_ID, false, false)?,
        // index: 6
        ExtraAccountMeta::new_external_pda_with_seeds(
            COMPTOKEN_PROGRAM_INDEX,
            &[Seed::AccountKey { index: SENDER_ACCOUNT_INDEX }],
            false,
            false,
        )?,
        // index: 7
        ExtraAccountMeta::new_external_pda_with_seeds(
            COMPTOKEN_PROGRAM_INDEX,
            &[Seed::AccountKey { index: RECEIVER_ACCOUNT_INDEX }],
            false,
            false,
        )?,
    ];

    let account_size = ExtraAccountMetaList::size_of(account_metas.len())? as u64;

    let lamports = Rent::get()?.minimum_balance(account_size as usize);

    let signer_seeds: &[&[&[u8]]] = &[EXTRA_ACCOUNT_METAS_ACCOUNT_SEEDS];

    create_pda(&payer_account, &account_meta_storage_account, lamports, account_size, program_id, signer_seeds)?;

    ExtraAccountMetaList::init::<ExecuteInstruction>(
        &mut account_meta_storage_account.try_borrow_mut_data()?,
        &account_metas,
    )?;

    Ok(())
}

fn is_bank(address: &Pubkey) -> bool {
    *address == COMPTO_INTEREST_BANK_ACCOUNT_PUBKEY || *address == COMPTO_UBI_BANK_ACCOUNT_PUBKEY
}
