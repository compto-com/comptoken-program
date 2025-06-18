use solana_program::{
    instruction::AccountMeta,
    {account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey},
};

use comptoken_utils::{create_pda, invoke_signed_verified, verify_accounts::VerifiedAccountInfo};

use crate::{
    constants::COMPTOKEN_ACCOUNT_SPACE,
    data::global_data::{GlobalData, GLOBAL_DATA_ACCOUNT_SPACE},
    generated::{
        COMPTOKEN_MINT_ADDRESS, COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS,
        COMPTO_INTEREST_BANK_ACCOUNT_SEEDS, COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS, TRANSFER_HOOK_ID,
    },
    get_next_data,
    instructions::{InstructionAccounts, InstructionData},
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

struct InitializeData {
    lamports_global_data: u64,
    lamports_unpaid_interest_bank: u64,
    lamports_unpaid_verified_human_ubi_bank: u64,
    lamports_unpaid_future_ubi_bank: u64,
}

impl InstructionData for InitializeData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if instruction_data.len() != std::mem::size_of::<InitializeData>() {
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }

        let (lamports_global_data, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        let (lamports_unpaid_interest_bank, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        let (lamports_unpaid_verified_human_ubi_bank, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        let (lamports_unpaid_future_ubi_bank, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        assert!(instruction_data.is_empty(), "incorrect instruction data");

        Ok(InitializeData {
            lamports_global_data,
            lamports_unpaid_interest_bank,
            lamports_unpaid_verified_human_ubi_bank,
            lamports_unpaid_future_ubi_bank,
        })
    }
}

#[rustfmt::skip]
struct InitializeAccounts<'a> {
    payer:                          VerifiedAccountInfo<'a>,
    comptoken_mint:                 VerifiedAccountInfo<'a>,
    global_data_account:            VerifiedAccountInfo<'a>,
    unpaid_interest_bank:           VerifiedAccountInfo<'a>,
    unpaid_verified_human_ubi_bank: VerifiedAccountInfo<'a>,
    unpaid_future_ubi_bank:         VerifiedAccountInfo<'a>,
    _transfer_hook_program:         VerifiedAccountInfo<'a>,
    extra_account_metas:            VerifiedAccountInfo<'a>,
    solana_program:                 VerifiedAccountInfo<'a>,
    _solana_token_2022_program:     VerifiedAccountInfo<'a>,
    slothashes:                     VerifiedAccountInfo<'a>,
}

impl<'a> InstructionAccounts<'a> for InitializeAccounts<'a> {
    type AdditionalVerificationData = ();

    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, _additional_data: Self::AdditionalVerificationData,
    ) -> Result<Self, solana_program::program_error::ProgramError> {
        #[rustfmt::skip]
        let verified_accounts = verify_accounts(
            accounts,
            program_id,
            AccountsToVerify {
                payer:                          Some(AccountMetaType::SignerAndWritable),
                comptoken_mint:                 Some(AccountMetaType::None),
                global_data_account:            Some(AccountMetaType::Writable),
                unpaid_interest_bank:           Some(AccountMetaType::Writable),
                unpaid_verified_human_ubi_bank: Some(AccountMetaType::Writable),
                unpaid_future_ubi_bank:         Some(AccountMetaType::Writable),
                transfer_hook_program:          Some(AccountMetaType::None),
                extra_account_metas:            Some(AccountMetaType::Writable),
                solana_program:                 Some(AccountMetaType::None),
                solana_token_2022_program:      Some(AccountMetaType::None),
                slothashes:                     Some(AccountMetaType::None),
                ..Default::default()
            },
        )?;

        Ok(InitializeAccounts {
            payer: verified_accounts.payer.unwrap(),
            comptoken_mint: verified_accounts.comptoken_mint.unwrap(),
            global_data_account: verified_accounts.global_data_account.unwrap(),
            unpaid_interest_bank: verified_accounts.unpaid_interest_bank.unwrap(),
            unpaid_verified_human_ubi_bank: verified_accounts.unpaid_verified_human_ubi_bank.unwrap(),
            unpaid_future_ubi_bank: verified_accounts.unpaid_future_ubi_bank.unwrap(),
            _transfer_hook_program: verified_accounts.transfer_hook_program.unwrap(),
            extra_account_metas: verified_accounts.extra_account_metas.unwrap(),
            solana_program: verified_accounts.solana_program.unwrap(),
            _solana_token_2022_program: verified_accounts.solana_token_2022_program.unwrap(),
            slothashes: verified_accounts.slothashes.unwrap(),
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

    let InitializeAccounts {
        payer,
        comptoken_mint,
        global_data_account,
        unpaid_interest_bank,
        unpaid_verified_human_ubi_bank,
        unpaid_future_ubi_bank,
        extra_account_metas,
        solana_program,
        slothashes,
        ..
    } = InitializeAccounts::verify_accounts(accounts, program_id, ())?;

    let InitializeData {
        lamports_global_data,
        lamports_unpaid_interest_bank,
        lamports_unpaid_verified_human_ubi_bank,
        lamports_unpaid_future_ubi_bank,
    } = InitializeData::from_instruction_data(instruction_data)?;

    msg!("Lamports global data: {:?}", lamports_global_data);
    msg!("Lamports unpaid interest bank: {:?}", lamports_unpaid_interest_bank);
    msg!("Lamports unpaid verified human ubi bank: {:?}", lamports_unpaid_verified_human_ubi_bank);
    msg!("Lamports unpaid future ubi bank: {:?}", lamports_unpaid_future_ubi_bank);

    create_pda(
        &payer,
        &global_data_account,
        lamports_global_data,
        GLOBAL_DATA_ACCOUNT_SPACE,
        program_id,
        &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS],
    )?;
    msg!("created global data account");
    create_pda(
        &payer,
        &unpaid_interest_bank,
        lamports_unpaid_interest_bank,
        COMPTOKEN_ACCOUNT_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_INTEREST_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created interest bank account");
    init_comptoken_account(&unpaid_interest_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized interest bank account");

    create_pda(
        &payer,
        &unpaid_verified_human_ubi_bank,
        lamports_unpaid_interest_bank,
        COMPTOKEN_ACCOUNT_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created verified human ubi bank account");
    init_comptoken_account(&unpaid_verified_human_ubi_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized verified human ubi bank account");

    create_pda(
        &payer,
        &unpaid_future_ubi_bank,
        lamports_unpaid_future_ubi_bank,
        COMPTOKEN_ACCOUNT_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created future ubi bank account");
    init_comptoken_account(&unpaid_future_ubi_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized future ubi bank account");

    let global_data: &mut GlobalData = (&global_data_account).into();
    global_data.initialize(&slothashes);

    let mut init_transfer_hook_instruction =
        spl_transfer_hook_interface::instruction::initialize_extra_account_meta_list(
            &TRANSFER_HOOK_ID,
            extra_account_metas.key,
            comptoken_mint.key,
            global_data_account.key,
            &[],
        );
    init_transfer_hook_instruction.accounts.push(AccountMeta::new(*payer.key, true));

    invoke_signed_verified(
        &init_transfer_hook_instruction,
        &[&extra_account_metas, &comptoken_mint, &global_data_account, &solana_program, &payer],
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
