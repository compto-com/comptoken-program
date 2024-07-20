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
use global_data::{DailyDistributionValues, GlobalData, ValidBlockhashes};
use user_data::{UserData, USER_DATA_MIN_SIZE};
use verify_accounts::*;

// declare and export the program's entrypoint
entrypoint!(process_instruction);

type ProgramResult = Result<(), ProgramError>;

// MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN test_client.js
const GLOBAL_DATA_ACCOUNT_SPACE: u64 = 4096;

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
    for account_info in accounts.iter() {
        msg!("Public Key: {:?}", account_info.key);
    }

    let account_info_iter = &mut accounts.iter();
    let _comptoken_mint_account = next_account_info(account_info_iter)?;
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let _solana_token_account = next_account_info(account_info_iter)?;

    verify_comptoken_mint(_comptoken_mint_account, true);
    verify_user_comptoken_wallet_account(user_comptoken_wallet_account, false, true)?;
    verify_global_data_account(global_data_account, program_id, false);

    let amount = 2;

    mint(global_data_account.key, user_comptoken_wallet_account.key, amount, &accounts[..3])
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

    verify_comptoken_mint(_comptoken_mint_account, true);
    verify_global_data_account(global_data_account, program_id, false);
    let global_data: &mut GlobalData = global_data_account.into();
    verify_user_comptoken_wallet_account(user_comptoken_wallet_account, false, true)?;
    let proof = verify_comptoken_proof_userdata(
        user_comptoken_wallet_account.key,
        instruction_data,
        &global_data.valid_blockhashes,
    );
    let _ = verify_user_data_account(user_data_account, user_comptoken_wallet_account, program_id, true);

    msg!("data/accounts verified");
    let amount = 2;
    // now save the hash to the account, returning an error if the hash already exists
    store_hash(proof, user_data_account);
    msg!("stored the proof");
    mint(global_data_account.key, &user_comptoken_wallet_account.key, amount, &accounts[..3])?;
    msg!("minted {} comptokens", amount);
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
    let ubi_bank = next_account_info(account_info_iter)?;
    let comptoken_mint = next_account_info(account_info_iter)?;
    let _solana_program = next_account_info(account_info_iter)?;
    let _token_2022_program = next_account_info(account_info_iter)?;
    let slot_hashes_account = next_account_info(account_info_iter)?;

    verify_payer_account(payer_account);
    verify_global_data_account(global_data_account, program_id, true);
    verify_interest_bank_account(unpaid_interest_bank, program_id, true);
    verify_ubi_bank_account(ubi_bank, program_id, true);
    verify_comptoken_mint(comptoken_mint, false);

    let first_8_bytes: [u8; 8] = instruction_data[0..8].try_into().unwrap();
    let lamports_global_data = u64::from_le_bytes(first_8_bytes);
    let lamports_interest_bank = u64::from_le_bytes(instruction_data[8..16].try_into().unwrap());
    let lamports_ubi_bank = u64::from_le_bytes(instruction_data[16..24].try_into().unwrap());
    msg!("Lamports global data: {:?}", lamports_global_data);
    msg!("Lamports interest bank: {:?}", lamports_interest_bank);
    msg!("Lamports ubi bank: {:?}", lamports_ubi_bank);

    create_pda(
        payer_account.key,
        global_data_account.key,
        lamports_global_data,
        GLOBAL_DATA_ACCOUNT_SPACE,
        program_id,
        &accounts[..2],
        &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS],
    )?;
    msg!("created global data account");
    create_pda(
        payer_account.key,
        &unpaid_interest_bank.key,
        lamports_interest_bank,
        INTEREST_BANK_SPACE,
        &spl_token_2022::ID,
        &[payer_account.clone(), unpaid_interest_bank.clone()],
        &[COMPTO_INTEREST_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created interest bank account");
    init_comptoken_account(unpaid_interest_bank, global_data_account.key, &[], comptoken_mint)?;
    msg!("initialized interest bank account");
    create_pda(
        payer_account.key,
        &ubi_bank.key,
        lamports_interest_bank,
        UBI_BANK_SPACE,
        &spl_token_2022::ID,
        &[payer_account.clone(), ubi_bank.clone()],
        &[COMPTO_UBI_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created ubi bank account");
    init_comptoken_account(ubi_bank, global_data_account.key, &[], comptoken_mint)?;
    msg!("initialized ubi bank account");

    let global_data: &mut GlobalData = global_data_account.try_into().unwrap();
    global_data.initialize(slot_hashes_account);

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

    verify_payer_account(payer_account);
    let bump = verify_user_data_account(user_data_account, user_comptoken_wallet_account, program_id, true);
    verify_user_comptoken_wallet_account(user_comptoken_wallet_account, false, false)?;

    create_pda(
        payer_account.key,
        user_data_account.key,
        rent_lamports,
        space as u64,
        program_id,
        &accounts[..2],
        &[&[&user_comptoken_wallet_account.key.as_ref(), &[bump]]],
    )?;

    // initialize data account
    let mut binding = user_data_account.try_borrow_mut_data()?;
    let data = binding.as_mut();

    let user_data: &mut UserData = data.try_into().expect("panicked already");
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

    verify_global_data_account(global_data_account, program_id, true);
    verify_interest_bank_account(unpaid_interest_bank, program_id, true);
    verify_ubi_bank_account(unpaid_ubi_bank, program_id, true);
    verify_slothashes_account(slot_hashes_account);

    let global_data: &mut GlobalData = global_data_account.try_into().unwrap();
    let comptoken_mint = Mint::unpack(comptoken_mint_account.try_borrow_data().unwrap().as_ref()).unwrap();

    let current_time = get_current_time();
    assert!(
        current_time < global_data.daily_distribution_data.last_daily_distribution_time + SEC_PER_DAY,
        "daily distribution already called today"
    );

    let DailyDistributionValues {
        interest_distributed: interest_daily_distribution,
        ubi_distributed: ubi_daily_distribution,
    } = global_data.daily_distribution_event(comptoken_mint, slot_hashes_account);

    // mint to banks
    mint(global_data_account.key, unpaid_interest_bank.key, interest_daily_distribution, &accounts[..3])?;
    mint(
        global_data_account.key,
        unpaid_ubi_bank.key,
        ubi_daily_distribution,
        &[comptoken_mint_account.clone(), global_data_account.clone(), unpaid_ubi_bank.clone()],
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

    verify_global_data_account(global_data_account, program_id, true);
    verify_slothashes_account(slot_hashes_account);

    let global_data: &mut GlobalData = global_data_account.try_into().unwrap();
    let valid_blockhashes = &mut global_data.valid_blockhashes;

    valid_blockhashes.update(slot_hashes_account);

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

    verify_user_data_account(user_data_account, user_comptoken_wallet_account, program_id, true);
    verify_user_comptoken_wallet_account(user_comptoken_wallet_account, false, true)?;
    verify_comptoken_mint(comptoken_mint_account, false);
    verify_global_data_account(global_data_account, program_id, false);
    verify_interest_bank_account(unpaid_interest_bank, program_id, true);
    verify_ubi_bank_account(unpaid_ubi_bank, program_id, true);

    let user_comptoken_wallet = Account::unpack(&user_comptoken_wallet_account.data.borrow())?;
    let global_data: &mut GlobalData = global_data_account.try_into().unwrap();
    let user_data: &mut UserData = user_data_account.try_into().unwrap();
    // get days since last update
    let current_day = normalize_time(get_current_time());
    let days_since_last_update = (user_data.last_interest_payout_date - current_day) / SEC_PER_DAY;

    msg!("total before interest: {}", user_comptoken_wallet.amount);
    // get interest
    let new_total = global_data
        .daily_distribution_data
        .apply_n_interests(days_since_last_update as usize, user_comptoken_wallet.amount);

    msg!("total after interest: {}", new_total);
    transfer(
        unpaid_interest_bank,
        user_comptoken_wallet_account,
        comptoken_mint_account,
        global_data_account,
        new_total - user_comptoken_wallet.amount,
    )?;

    // get ubi if verified
    if user_data.is_verified_human {
        transfer(
            unpaid_ubi_bank,
            user_comptoken_wallet_account,
            comptoken_mint_account,
            global_data_account,
            0, // TODO figure out correct amount
        )?;
    }

    Ok(())
}

pub fn realloc_user_data() {
    // TODO implement
}

fn mint(mint_authority: &Pubkey, destination_wallet: &Pubkey, amount: u64, accounts: &[AccountInfo]) -> ProgramResult {
    let instruction = mint_to(
        &spl_token_2022::id(),
        &COMPTOKEN_MINT_ADDRESS,
        &destination_wallet,
        &mint_authority,
        &[&mint_authority],
        amount,
    )?;
    invoke_signed(&instruction, accounts, &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS])
}

fn transfer<'a>(
    source: &AccountInfo<'a>, destination: &AccountInfo<'a>, mint: &AccountInfo<'a>, global_data: &AccountInfo<'a>,
    amount: u64,
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
    invoke_signed(
        &instruction,
        &[source.clone(), mint.clone(), destination.clone(), global_data.clone()],
        &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS],
    )
}

fn create_pda(
    payer_pubkey: &Pubkey, new_account_key: &Pubkey, lamports: u64, space: u64, owner_key: &Pubkey,
    accounts: &[AccountInfo], signers_seeds: &[&[&[u8]]],
) -> ProgramResult {
    let create_acct_instr =
        system_instruction::create_account(payer_pubkey, &new_account_key, lamports, space, owner_key);
    // The PDA that is being created must sign for its own creation.
    invoke_signed(&create_acct_instr, accounts, signers_seeds)
}

fn init_comptoken_account<'a>(
    account: &AccountInfo<'a>, owner_key: &Pubkey, signer_seeds: &[&[&[u8]]], mint: &AccountInfo<'a>,
) -> ProgramResult {
    let init_comptoken_account_instr = spl_token_2022::instruction::initialize_account3(
        &spl_token_2022::ID,
        &account.key,
        &COMPTOKEN_MINT_ADDRESS,
        &owner_key,
    )?;
    invoke_signed(&init_comptoken_account_instr, &[account.clone(), mint.clone()], signer_seeds)
}

fn store_hash(proof: ComptokenProof, data_account: &AccountInfo) {
    let user_data: &mut UserData = data_account.data.borrow_mut().as_mut().try_into().expect("error already panicked");
    user_data.insert(&proof.hash, &proof.recent_block_hash)
}

fn verify_comptoken_proof_userdata<'a>(
    comptoken_wallet: &'a Pubkey, data: &[u8], valid_blockhashes: &ValidBlockhashes,
) -> ComptokenProof<'a> {
    assert_eq!(data.len(), comptoken_proof::VERIFY_DATA_SIZE, "Invalid proof size");
    let proof = ComptokenProof::from_bytes(comptoken_wallet, data.try_into().expect("correct size"));
    msg!("block: {:?}", proof);
    assert!(comptoken_proof::verify_proof(&proof, valid_blockhashes), "invalid proof");
    return proof;
}

fn get_current_time() -> i64 {
    Clock::get().unwrap().unix_timestamp
}

fn normalize_time(time: i64) -> i64 {
    time - time % SEC_PER_DAY // midnight today, UTC+0
}
