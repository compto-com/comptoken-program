mod generated;
mod verify_accounts;

use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_token_2022::solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg, pubkey,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};

use comptoken_utils::create_pda;

use generated::{COMPTOKEN_ID, EXTRA_ACCOUNT_METAS_ACCOUNT_SEEDS};
use verify_accounts::{
    verify_account_meta_storage_account, verify_mint_account, verify_mint_authority, VerifiedAccountInfo,
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

fn process_execute(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    todo!()
}

fn process_initialize_extra_account_meta_list(
    program_id: &Pubkey, accounts: &[AccountInfo], _extra_account_metas: Vec<ExtraAccountMeta>,
) -> ProgramResult {
    //      [writable]: Validation account
    //      []: Mint
    //      [signer]: Mint authority
    //      []: System program
    //      [signer, writable]: payer account (not part of the standard)

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
