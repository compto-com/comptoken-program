mod comptoken_proof;
mod constants;
mod generated;
mod global_data;
mod instructions;
mod verify_accounts;

use solana_program::{account_info::AccountInfo, entrypoint, msg, program_error::ProgramError, pubkey::Pubkey};
use spl_token_2022::{instruction::mint_to, onchain};

use generated::{COMPTOKEN_MINT_ADDRESS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS};
use verify_accounts::VerifiedAccountInfo;

// declare and export the program's entrypoint
entrypoint!(process_instruction);

type ProgramResult = Result<(), ProgramError>;

// program entrypoint's implementation
pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    msg!("instruction_data: {:?}", instruction_data);
    let (instruction, instruction_data) = get_next_data(instruction_data, 1, |b| b[0]);
    match instruction {
        1 => {
            msg!("Mint New Comptokens");
            instructions::submit_proof(program_id, accounts, instruction_data)
        }
        2 => {
            msg!("Initialize Comptoken Program");
            instructions::initialize(program_id, accounts, instruction_data)
        }
        3 => {
            msg!("Create User Data Account");
            instructions::create_user_data_account(program_id, accounts, instruction_data)
        }
        4 => {
            msg!("Perform Daily Distribution Event");
            instructions::daily_distribution(program_id, accounts, instruction_data)
        }
        5 => {
            msg!("Get Valid Blockhashes");
            instructions::get_valid_blockhashes(program_id, accounts, instruction_data)
        }
        6 => {
            msg!("Get Owed Comptokens");
            instructions::collect(program_id, accounts, instruction_data)
        }
        7 => {
            msg!("Grow User Data Acccount");
            instructions::resize_user_data(program_id, accounts, instruction_data)
        }
        8 => {
            msg!("Verify Human");
            instructions::verify_human(program_id, accounts, instruction_data)
        }
        255 => {
            msg!("Mint Unchecked");
            instructions::mint_unchecked(program_id, accounts, instruction_data)
        }
        _ => {
            msg!("Invalid Instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

fn mint(
    mint_authority: &VerifiedAccountInfo, destination_wallet: &VerifiedAccountInfo, amount: u64,
    accounts: &[&VerifiedAccountInfo],
) -> ProgramResult {
    let instruction = mint_to(
        &spl_token_2022::id(),
        &COMPTOKEN_MINT_ADDRESS,
        destination_wallet.key,
        mint_authority.key,
        &[mint_authority.key],
        amount,
    )?;
    comptoken_utils::invoke_signed_verified(&instruction, accounts, &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS])
}

fn transfer<'a>(
    source: &VerifiedAccountInfo<'a>, destination: &VerifiedAccountInfo<'a>, mint: &VerifiedAccountInfo<'a>,
    global_data: &VerifiedAccountInfo<'a>, additional_accounts: &[&VerifiedAccountInfo<'a>], amount: u64,
) -> ProgramResult {
    let additional_accounts: Vec<_> = additional_accounts.iter().map(|account| account.0.clone()).collect();
    onchain::invoke_transfer_checked(
        &spl_token_2022::ID,
        source.0.clone(),
        mint.0.clone(),
        destination.0.clone(),
        global_data.0.clone(),
        &additional_accounts,
        amount,
        constants::MINT_DECIMALS,
        &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS],
    )
}

fn get_next_data<'a, T>(data: &'a [u8], size: usize, converter: impl FnOnce(&'a [u8]) -> T) -> (T, &'a [u8]) {
    assert!(data.len() >= size, "not enough data");
    let (data, rest) = data.split_at(size);
    (converter(data), rest)
}
