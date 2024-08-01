mod comptoken_proof;
mod constants;
mod global_data;
mod user_data;
mod verify_accounts;

extern crate bs58;

use spl_token_2022::{
    instruction::mint_to,
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        clock::Clock,
        entrypoint,
        hash::HASH_BYTES,
        instruction::Instruction,
        msg,
        program::{invoke_signed, set_return_data},
        program_pack::Pack,
        pubkey::Pubkey,
        system_instruction,
        sysvar::{slot_history::ProgramError, Sysvar},
    },
    state::{Account, Mint},
};

use comptoken_proof::ComptokenProof;
use constants::*;
use global_data::{daily_distribution_data::DailyDistributionValues, valid_blockhashes::ValidBlockhashes, GlobalData};
use user_data::{UserData, USER_DATA_MIN_SIZE};
use verify_accounts::*;

// declare and export the program's entrypoint
entrypoint!(process_instruction);

type ProgramResult = Result<(), ProgramError>;

const GLOBAL_DATA_ACCOUNT_SPACE: u64 = std::mem::size_of::<GlobalData>() as u64;

mod generated;
use generated::{
    COMPTOKEN_MINT_ADDRESS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, COMPTO_INTEREST_BANK_ACCOUNT_SEEDS,
    COMPTO_UBI_BANK_ACCOUNT_SEEDS,
};

const INTEREST_BANK_SPACE: u64 = 256; // TODO get actual size
const UBI_BANK_SPACE: u64 = 256; // TODO get actual size

// program entrypoint's implementation
pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    msg!("instruction_data: {:?}", instruction_data);
    match instruction_data[0] {
        0 => {
            msg!("Test Mint");
            test_mint(program_id, accounts, &instruction_data[1..])
        }
        1 => {
            msg!("Mint New Comptokens");
            mint_comptokens(program_id, accounts, &instruction_data[1..])
        }
        2 => {
            msg!("Initialize Comptoken Program");
            initialize_comptoken_program(program_id, accounts, &instruction_data[1..])
        }
        3 => {
            msg!("Create User Data Account");
            create_user_data_account(program_id, accounts, &instruction_data[1..])
        }
        4 => {
            msg!("Perform Daily Distribution Event");
            daily_distribution_event(program_id, accounts, &instruction_data[1..])
        }
        5 => {
            msg!("Get Valid Blockhashes");
            get_valid_blockhashes(program_id, accounts, &instruction_data[1..])
        }
        6 => {
            msg!("Get Owed Comptokens");
            get_owed_comptokens(program_id, accounts, &instruction_data[1..])
        }
        _ => {
            msg!("Invalid Instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

pub fn test_mint(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      Comptoken Mint account
    //      Testuser Comptoken Wallet
    //      Global Data (also Mint Authority)
    //      Solana Token 2022

    msg!("instruction_data: {:?}", instruction_data);

    let account_info_iter = &mut accounts.iter();
    let comptoken_mint_account = next_account_info(account_info_iter)?;
    msg!("Comptoken Mint Key: {:?}", comptoken_mint_account.key);
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    msg!("User Comptoken Wallet Key: {:?}", user_comptoken_wallet_account.key);
    let global_data_account = next_account_info(account_info_iter)?;
    msg!("Global Data Key: {:?}", global_data_account.key);
    let _solana_token_account = next_account_info(account_info_iter)?;
    msg!("Solana Token Key: {:?}", _solana_token_account.key);

    let comptoken_mint_account = verify_comptoken_mint(comptoken_mint_account, true);
    let user_comptoken_wallet_account =
        verify_user_comptoken_wallet_account(user_comptoken_wallet_account, false, true);
    let global_data_account = verify_global_data_account(global_data_account, program_id, false);

    let amount = 2;

    mint(
        &global_data_account,
        &user_comptoken_wallet_account,
        amount,
        &[&comptoken_mint_account, &user_comptoken_wallet_account, &global_data_account],
    )
}

pub fn mint_comptokens(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      Comptoken Mint (writable)
    //      User Comptoken Wallet (writable)
    //      Global Data (also Mint Authority)
    //      User Data (writable)
    //      Solana Token 2022

    let account_info_iter = &mut accounts.iter();
    let _comptoken_mint_account = next_account_info(account_info_iter)?;
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let user_data_account = next_account_info(account_info_iter)?;
    let _solana_token_account = next_account_info(account_info_iter)?;

    let comptoken_mint_account = verify_comptoken_mint(_comptoken_mint_account, true);
    let global_data_account = verify_global_data_account(global_data_account, program_id, false);
    let global_data: &mut GlobalData = (&global_data_account).into();
    let user_comptoken_wallet_account =
        verify_user_comptoken_wallet_account(user_comptoken_wallet_account, false, true);
    let proof = verify_comptoken_proof_userdata(
        &user_comptoken_wallet_account,
        instruction_data,
        &global_data.valid_blockhashes,
    );
    let (user_data_account, _) =
        verify_user_data_account(user_data_account, &user_comptoken_wallet_account, program_id, true);

    msg!("data/accounts verified");
    let amount = 2;
    // now save the hash to the account, returning an error if the hash already exists
    store_hash(proof, &user_data_account);
    msg!("stored the proof");
    mint(
        &global_data_account,
        &user_comptoken_wallet_account,
        amount,
        &[&comptoken_mint_account, &user_comptoken_wallet_account, &global_data_account],
    )?;

    Ok(())
}

pub fn initialize_comptoken_program(
    program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      Payer (probably COMPTO's account)
    //      Global Data Account (also mint authority)
    //      Comptoken Interest Bank
    //      Comptoken UBI Bank
    //      Comptoken Mint
    //      Solana Program
    //      Solana Token 2022 Program
    //      Solana SlotHashes Sysvar

    msg!("instruction_data: {:?}", instruction_data);

    let account_info_iter = &mut accounts.iter();
    let payer_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let unpaid_interest_bank = next_account_info(account_info_iter)?;
    let unpaid_ubi_bank = next_account_info(account_info_iter)?;
    let comptoken_mint = next_account_info(account_info_iter)?;
    let _solana_program = next_account_info(account_info_iter)?;
    let _token_2022_program = next_account_info(account_info_iter)?;
    let slot_hashes_account = next_account_info(account_info_iter)?;

    let payer_account = verify_payer_account(payer_account);
    let global_data_account = verify_global_data_account(global_data_account, program_id, true);
    let unpaid_interest_bank = verify_interest_bank_account(unpaid_interest_bank, program_id, true);
    let unpaid_ubi_bank = verify_ubi_bank_account(unpaid_ubi_bank, program_id, true);
    let comptoken_mint = verify_comptoken_mint(comptoken_mint, false);
    let slot_hashes_account = verify_slothashes_account(slot_hashes_account);

    let first_8_bytes: [u8; 8] = instruction_data[0..8].try_into().unwrap();
    let lamports_global_data = u64::from_le_bytes(first_8_bytes);
    let lamports_interest_bank = u64::from_le_bytes(instruction_data[8..16].try_into().unwrap());
    let lamports_ubi_bank = u64::from_le_bytes(instruction_data[16..24].try_into().unwrap());
    msg!("Lamports global data: {:?}", lamports_global_data);
    msg!("Lamports interest bank: {:?}", lamports_interest_bank);
    msg!("Lamports ubi bank: {:?}", lamports_ubi_bank);

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
        INTEREST_BANK_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_INTEREST_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created interest bank account");
    init_comptoken_account(&unpaid_interest_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized interest bank account");
    create_pda(
        &payer_account,
        &unpaid_ubi_bank,
        lamports_interest_bank,
        UBI_BANK_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_UBI_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created ubi bank account");
    init_comptoken_account(&unpaid_ubi_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized ubi bank account");

    let global_data: &mut GlobalData = (&global_data_account).into();
    global_data.initialize(&slot_hashes_account);

    Ok(())
}

pub fn create_user_data_account(
    program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8],
) -> ProgramResult {
    //  Account Order
    //      User's Solana Wallet (signer)
    //      User's Data (writable)
    //      User's Comptoken Wallet
    //      Solana Program

    let account_info_iter = &mut accounts.iter();

    let payer_account = next_account_info(account_info_iter)?;
    let user_data_account = next_account_info(account_info_iter)?;
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    let _solana_program = next_account_info(account_info_iter)?;

    // find space and minimum rent required for account
    let rent_lamports = u64::from_le_bytes(instruction_data[0..8].try_into().expect("correct size"));
    let space = usize::from_le_bytes(instruction_data[8..16].try_into().expect("correct size"));
    msg!("space: {}", space);
    assert!(space >= USER_DATA_MIN_SIZE);
    assert!((space - USER_DATA_MIN_SIZE) % HASH_BYTES == 0);

    let payer_account = verify_payer_account(payer_account);
    let user_comptoken_wallet_account =
        verify_user_comptoken_wallet_account(user_comptoken_wallet_account, false, false);
    let (user_data_account, bump) =
        verify_user_data_account(user_data_account, &user_comptoken_wallet_account, program_id, true);

    create_pda(
        &payer_account,
        &user_data_account,
        rent_lamports,
        space as u64,
        program_id,
        &[&[user_comptoken_wallet_account.key.as_ref(), &[bump]]],
    )?;

    // initialize data account
    let user_data: &mut UserData = (&user_data_account).into();
    user_data.initialize();

    Ok(())
}

pub fn daily_distribution_event(
    program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      Comptoken Mint
    //      Comptoken Global Data (also mint authority)
    //      Comptoken Interest Bank
    //      Comptoken UBI Bank
    //      Solana Token Program
    //      Solana SlotHashes Sysvar

    let account_info_iter = &mut accounts.iter();
    let comptoken_mint_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let unpaid_interest_bank = next_account_info(account_info_iter)?;
    let unpaid_ubi_bank = next_account_info(account_info_iter)?;
    let _solana_token_account = next_account_info(account_info_iter)?;
    let slot_hashes_account = next_account_info(account_info_iter)?;

    let comptoken_mint_account = verify_comptoken_mint(comptoken_mint_account, false);
    let global_data_account = verify_global_data_account(global_data_account, program_id, true);
    let unpaid_interest_bank = verify_interest_bank_account(unpaid_interest_bank, program_id, true);
    let unpaid_ubi_bank = verify_ubi_bank_account(unpaid_ubi_bank, program_id, true);
    let slot_hashes_account = verify_slothashes_account(slot_hashes_account);

    let global_data: &mut GlobalData = (&global_data_account).into();
    let comptoken_mint = Mint::unpack(comptoken_mint_account.try_borrow_data().unwrap().as_ref()).unwrap();

    let current_time = get_current_time();
    assert!(
        current_time > global_data.daily_distribution_data.last_daily_distribution_time + SEC_PER_DAY,
        "daily distribution already called today"
    );

    let DailyDistributionValues {
        interest_distributed: interest_daily_distribution,
        ubi_distributed: ubi_daily_distribution,
    } = global_data.daily_distribution_event(comptoken_mint, &slot_hashes_account);

    // mint to banks
    mint(
        &global_data_account,
        &unpaid_interest_bank,
        interest_daily_distribution,
        &[&comptoken_mint_account, &global_data_account, &unpaid_interest_bank],
    )?;
    mint(
        &global_data_account,
        &unpaid_ubi_bank,
        ubi_daily_distribution,
        &[&comptoken_mint_account, &global_data_account, &unpaid_ubi_bank],
    )?;

    Ok(())
}

pub fn get_valid_blockhashes(program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      Comptoken Global Data (also mint authority) (writable)
    //      Solana SlotHashes Sysvar

    let account_info_iter = &mut accounts.iter();
    let global_data_account = next_account_info(account_info_iter)?;
    let slot_hashes_account = next_account_info(account_info_iter)?;

    let global_data_account = verify_global_data_account(global_data_account, program_id, true);
    let slot_hashes_account = verify_slothashes_account(slot_hashes_account);

    let global_data: &mut GlobalData = (&global_data_account).into();
    let valid_blockhashes = &mut global_data.valid_blockhashes;

    valid_blockhashes.update(&slot_hashes_account);

    let mut data = Vec::from(global_data.valid_blockhashes.valid_blockhash.to_bytes());
    data.extend(global_data.valid_blockhashes.announced_blockhash.to_bytes());
    set_return_data(&data);
    Ok(())
}

pub fn get_owed_comptokens(program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      User's Data (writable)
    //      User's Comptoken Wallet (writable)
    //      Comptoken Mint
    //      Comptoken Global Data (also mint authority)
    //      Comptoken Interest Bank (writable)
    //      Comptoken UBI Bank (writable)
    //      Solana Token 2022 Program

    let account_info_iter = &mut accounts.iter();
    let user_data_account = next_account_info(account_info_iter)?;
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    let comptoken_mint_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let unpaid_interest_bank = next_account_info(account_info_iter)?;
    let unpaid_ubi_bank = next_account_info(account_info_iter)?;
    let _solana_token_account = next_account_info(account_info_iter)?;

    let user_comptoken_wallet_account =
        verify_user_comptoken_wallet_account(user_comptoken_wallet_account, false, true);
    let (user_data_account, _) =
        verify_user_data_account(user_data_account, &user_comptoken_wallet_account, program_id, true);
    let comptoken_mint_account = verify_comptoken_mint(comptoken_mint_account, false);
    let global_data_account = verify_global_data_account(global_data_account, program_id, false);
    let unpaid_interest_bank = verify_interest_bank_account(unpaid_interest_bank, program_id, true);
    let unpaid_ubi_bank = verify_ubi_bank_account(unpaid_ubi_bank, program_id, true);

    let user_comptoken_wallet =
        Account::unpack(user_comptoken_wallet_account.try_borrow_data().unwrap().as_ref()).unwrap();
    let global_data: &mut GlobalData = (&global_data_account).into();
    let user_data: &mut UserData = (&user_data_account).into();

    // get days since last update
    let current_day = normalize_time(get_current_time());
    let days_since_last_update = (current_day - user_data.last_interest_payout_date) / SEC_PER_DAY;

    msg!("total before interest: {}", user_comptoken_wallet.amount);
    // get interest
    let interest = global_data
        .daily_distribution_data
        .apply_n_interests(days_since_last_update as usize, user_comptoken_wallet.amount)
        - user_comptoken_wallet.amount;

    msg!("Interest: {}", interest);

    transfer(
        &unpaid_interest_bank,
        &user_comptoken_wallet_account,
        &comptoken_mint_account,
        &global_data_account,
        interest,
    )?;

    // get ubi if verified
    if user_data.is_verified_human {
        transfer(
            &unpaid_ubi_bank,
            &user_comptoken_wallet_account,
            &comptoken_mint_account,
            &global_data_account,
            0, // TODO figure out correct amount
        )?;
    }

    user_data.last_interest_payout_date = current_day;
    Ok(())
}

pub fn realloc_user_data() {
    // TODO implement
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
    invoke_signed_verified(&instruction, accounts, &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS])
}

fn transfer<'a>(
    source: &VerifiedAccountInfo<'a>, destination: &VerifiedAccountInfo<'a>, mint: &VerifiedAccountInfo<'a>,
    global_data: &VerifiedAccountInfo<'a>, amount: u64,
) -> ProgramResult {
    let instruction = spl_token_2022::instruction::transfer_checked(
        &spl_token_2022::ID,
        source.key,
        mint.key,
        destination.key,
        global_data.key,
        &[],
        amount,
        MINT_DECIMALS,
    )?;
    invoke_signed_verified(&instruction, &[source, mint, destination, global_data], &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS])
}

fn create_pda<'a>(
    payer: &VerifiedAccountInfo<'a>, new_account: &VerifiedAccountInfo<'a>, lamports: u64, space: u64, owner: &Pubkey,
    signers_seeds: &[&[&[u8]]],
) -> ProgramResult {
    let create_acct_instr = system_instruction::create_account(payer.key, new_account.key, lamports, space, owner);
    // The PDA that is being created must sign for its own creation.
    invoke_signed_verified(&create_acct_instr, &[payer, new_account], signers_seeds)
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

fn store_hash(proof: ComptokenProof, data_account: &VerifiedAccountInfo) {
    let user_data: &mut UserData = data_account.into();
    user_data.insert(&proof.hash, &proof.recent_block_hash)
}

fn verify_comptoken_proof_userdata<'a>(
    comptoken_wallet: &'a VerifiedAccountInfo, data: &[u8], valid_blockhashes: &ValidBlockhashes,
) -> ComptokenProof<'a> {
    assert_eq!(data.len(), comptoken_proof::VERIFY_DATA_SIZE, "Invalid proof size");
    let proof = ComptokenProof::from_bytes(comptoken_wallet.key, data.try_into().expect("correct size"));
    msg!("block: {:?}", proof);
    assert!(comptoken_proof::verify_proof(&proof, valid_blockhashes), "invalid proof");
    proof
}

fn get_current_time() -> i64 {
    Clock::get().unwrap().unix_timestamp
}

fn normalize_time(time: i64) -> i64 {
    time - time % SEC_PER_DAY // midnight today, UTC+0
}

fn invoke_signed_verified<'a>(
    instruction: &Instruction, accounts: &[&VerifiedAccountInfo<'a>], signers_seeds: &[&[&[u8]]],
) -> ProgramResult {
    // Convert VerifiedAccountInfo references to AccountInfo references
    let account_refs: Vec<AccountInfo<'a>> = accounts.iter().map(|acct| acct.0.clone()).collect();
    invoke_signed(instruction, &account_refs[..], signers_seeds)
}
