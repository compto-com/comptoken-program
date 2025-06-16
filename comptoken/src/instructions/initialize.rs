use solana_program::{
    instruction::AccountMeta,
    {account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey},
};

use comptoken_utils::{create_pda, invoke_signed_verified, verify_accounts::VerifiedAccountInfo};

use crate::{
    constants::COMPTOKEN_ACCOUNT_SPACE,
    generated::{
        COMPTOKEN_MINT_ADDRESS, COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS,
        COMPTO_INTEREST_BANK_ACCOUNT_SEEDS, COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS, TRANSFER_HOOK_ID,
    },
    get_next_data,
    global_data::{GlobalData, GLOBAL_DATA_ACCOUNT_SPACE},
    instructions::InstructionData,
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

struct InitializeData {
    lamports_global_data: u64,
    lamports_interest_bank: u64,
    lamports_verified_human_ubi_bank: u64,
    lamports_future_ubi_bank: u64,
}

impl InstructionData for InitializeData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if instruction_data.len() != std::mem::size_of::<InitializeData>() {
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }

        let (lamports_global_data, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        let (lamports_interest_bank, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        let (lamports_verified_human_ubi_bank, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        let (lamports_future_ubi_bank, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        assert!(instruction_data.is_empty(), "incorrect instruction data");

        Ok(InitializeData {
            lamports_global_data,
            lamports_interest_bank,
            lamports_verified_human_ubi_bank,
            lamports_future_ubi_bank,
        })
    }
}

pub fn initialize(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [s, w] Payer (probably COMPTO's account)
    //      [] Comptoken Mint
    //      [w] Global Data Account (also mint authority)
    //      [w] Comptoken Interest Bank
    //      [w] Comptoken Verified Human UBI Bank
    //      [w] Comptoken Future UBI Bank
    //      [] Transfer Hook Program
    //      [w] Extra Account Metas Account
    //      [] Solana Program
    //      [] Solana Token 2022 Program
    //      [] Solana SlotHashes Sysvar
    //  data:
    //      8 bytes - lamports for global data
    //      8 bytes - lamports for interest bank
    //      8 bytes - lamports for verified human ubi bank
    //      8 bytes - lamports for future ubi bank

    #[rustfmt::skip]
    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            payer:                     Some(AccountMetaType::SignerAndWritable),
            comptoken_mint:            Some(AccountMetaType::None),
            global_data:               Some(AccountMetaType::Writable),
            interest_bank:             Some(AccountMetaType::Writable),
            verified_human_ubi_bank:   Some(AccountMetaType::Writable),
            future_ubi_bank:           Some(AccountMetaType::Writable),
            transfer_hook_program:     Some(AccountMetaType::None),
            extra_account_metas:       Some(AccountMetaType::Writable),
            solana_program:            Some(AccountMetaType::None),
            solana_token_2022_program: Some(AccountMetaType::None),
            slothashes:                Some(AccountMetaType::None),
            ..Default::default()
        },
    )?;

    let payer_account = verified_accounts.payer.unwrap();
    let comptoken_mint = verified_accounts.comptoken_mint.unwrap();
    let global_data_account = verified_accounts.global_data.unwrap();
    let unpaid_interest_bank = verified_accounts.interest_bank.unwrap();
    let unpaid_verified_human_ubi_bank = verified_accounts.verified_human_ubi_bank.unwrap();
    let unpaid_future_ubi_bank = verified_accounts.future_ubi_bank.unwrap();
    let extra_account_metas_account = verified_accounts.extra_account_metas.unwrap();
    let solana_program = verified_accounts.solana_program.unwrap();
    let slothashes_account = verified_accounts.slothashes.unwrap();

    let InitializeData {
        lamports_global_data,
        lamports_interest_bank,
        lamports_verified_human_ubi_bank,
        lamports_future_ubi_bank,
    } = InitializeData::from_instruction_data(instruction_data)?;

    msg!("Lamports global data: {:?}", lamports_global_data);
    msg!("Lamports interest bank: {:?}", lamports_interest_bank);
    msg!("Lamports verified human ubi bank: {:?}", lamports_verified_human_ubi_bank);
    msg!("Lamports future ubi bank: {:?}", lamports_future_ubi_bank);

    create_pda(
        &payer_account,
        &global_data_account,
        lamports_global_data,
        GLOBAL_DATA_ACCOUNT_SPACE,
        program_id,
        &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS],
    )?;
    msg!("created global data account");
    create_pda(
        &payer_account,
        &unpaid_interest_bank,
        lamports_interest_bank,
        COMPTOKEN_ACCOUNT_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_INTEREST_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created interest bank account");
    init_comptoken_account(&unpaid_interest_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized interest bank account");

    create_pda(
        &payer_account,
        &unpaid_verified_human_ubi_bank,
        lamports_interest_bank,
        COMPTOKEN_ACCOUNT_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created verified human ubi bank account");
    init_comptoken_account(&unpaid_verified_human_ubi_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized verified human ubi bank account");

    create_pda(
        &payer_account,
        &unpaid_future_ubi_bank,
        lamports_future_ubi_bank,
        COMPTOKEN_ACCOUNT_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created future ubi bank account");
    init_comptoken_account(&unpaid_future_ubi_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized future ubi bank account");

    let global_data: &mut GlobalData = (&global_data_account).into();
    global_data.initialize(&slothashes_account);

    let mut init_transfer_hook_instruction =
        spl_transfer_hook_interface::instruction::initialize_extra_account_meta_list(
            &TRANSFER_HOOK_ID,
            extra_account_metas_account.key,
            comptoken_mint.key,
            global_data_account.key,
            &[],
        );
    init_transfer_hook_instruction.accounts.push(AccountMeta::new(*payer_account.key, true));

    invoke_signed_verified(
        &init_transfer_hook_instruction,
        &[
            &extra_account_metas_account,
            &comptoken_mint,
            &global_data_account,
            &solana_program,
            &payer_account,
        ],
        &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS],
    )
}

fn init_comptoken_account<'a>(
    account: &VerifiedAccountInfo<'a>, owner: &VerifiedAccountInfo, signer_seeds: &[&[&[u8]]],
    mint: &VerifiedAccountInfo<'a>,
) -> ProgramResult {
    let init_comptoken_account_instr = spl_token_2022::instruction::initialize_account3(
        &spl_token_2022::ID,
        account.key,
        &COMPTOKEN_MINT_ADDRESS,
        owner.key,
    )?;
    invoke_signed_verified(&init_comptoken_account_instr, &[account, mint], signer_seeds)
}
