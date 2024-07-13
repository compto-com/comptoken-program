mod comptoken_proof;
mod global_data;
mod user_data;
mod verify_accounts;

extern crate bs58;

use spl_token_2022::{
    instruction::mint_to,
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint,
        hash::Hash,
        hash::HASH_BYTES,
        msg,
        program::invoke_signed,
        program_pack::Pack,
        pubkey::Pubkey,
        system_instruction,
        sysvar::slot_history::ProgramError,
    },
    state::Mint,
};

use comptoken_proof::ComptokenProof;
use global_data::GlobalData;
use user_data::{UserData, USER_DATA_MIN_SIZE};
use verify_accounts::{
    verify_comptoken_user_data_account, verify_global_data_account, verify_interest_bank_account,
    verify_ubi_bank_account, verify_user_comptoken_wallet_account,
};

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

// #[derive(Debug, Default, BorshDeserialize, BorshSerialize)]
// pub struct DataAccount {
//     pub hash: [u8; 32], // Assuming you want to store a 32-byte hash
// }

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
            msg!("Initialize Static Data Account");
            create_global_data_account(program_id, accounts, &instruction_data[1..])
        }
        3 => {
            msg!("Create User Data Account");
            create_user_data_account(program_id, accounts, &instruction_data[1..])
        }
        4 => {
            msg!("Perform Daily Distribution Event");
            daily_distribution_event(program_id, accounts, &instruction_data[1..])
        }
        _ => {
            msg!("Invalid Instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

pub fn test_mint(_program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      Comptoken Mint account
    //      Testuser Comptoken Wallet
    //      Mint Authority (also Global Data)
    //      Solana Token 2022

    msg!("instruction_data: {:?}", instruction_data);
    for account_info in accounts.iter() {
        msg!("Public Key: {:?}", account_info.key);
    }

    let account_info_iter = &mut accounts.iter();
    let _comptoken_mint_account = next_account_info(account_info_iter)?;
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    let mint_authority_account = next_account_info(account_info_iter)?;
    let _solana_token_account = next_account_info(account_info_iter)?;

    verify_user_comptoken_wallet_account(user_comptoken_wallet_account)?;

    let amount = 2;

    mint(mint_authority_account.key, user_comptoken_wallet_account.key, amount, &accounts[..3])
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

    verify_global_data_account(global_data_account, program_id);
    let global_data: &mut GlobalData = global_data_account.try_into()?;
    verify_user_comptoken_wallet_account(user_comptoken_wallet_account)?;
    let proof = verify_comptoken_proof_userdata(
        user_comptoken_wallet_account.key,
        instruction_data,
        &global_data.valid_blockhash,
    );
    let _ = verify_comptoken_user_data_account(user_data_account, user_comptoken_wallet_account, program_id);

    msg!("data/accounts verified");
    let amount = 2;
    // now save the hash to the account, returning an error if the hash already exists
    store_hash(proof, user_data_account);
    msg!("stored the proof");
    mint(global_data_account.key, &user_comptoken_wallet_account.key, amount, &accounts[..3])?;

    Ok(())
}

pub fn create_global_data_account(
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

    msg!("instruction_data: {:?}", instruction_data);

    let account_info_iter = &mut accounts.iter();
    let payer_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let unpaid_interest_bank = next_account_info(account_info_iter)?;
    let ubi_bank = next_account_info(account_info_iter)?;
    let comptoken_mint = next_account_info(account_info_iter)?;
    let _solana_program = next_account_info(account_info_iter)?;
    let _token_2022_program = next_account_info(account_info_iter)?;

    // necessary because we use the user provided pubkey to retrieve the data
    verify_global_data_account(global_data_account, program_id);
    verify_interest_bank_account(unpaid_interest_bank, program_id);
    verify_ubi_bank_account(ubi_bank, program_id);

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
    init_comptoken_account(unpaid_interest_bank, program_id, &[], comptoken_mint)?;
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
    init_comptoken_account(ubi_bank, program_id, &[], comptoken_mint)?;
    msg!("initialized ubi bank account");

    let global_data: &mut GlobalData = global_data_account.try_into().unwrap();
    global_data.initialize();

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

    let bump = verify_comptoken_user_data_account(user_data_account, user_comptoken_wallet_account, program_id);

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

// under construction
pub fn daily_distribution_event(
    program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      Comptoken Mint
    //      Comptoken Global Data (also mint authority)
    //      Comptoken Interest Bank
    //      Comptoken UBI Bank

    let account_info_iter = &mut accounts.iter();
    let comptoken_mint_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let unpaid_interest_bank = next_account_info(account_info_iter)?;
    let ubi_bank = next_account_info(account_info_iter)?;

    verify_global_data_account(global_data_account, program_id);
    verify_interest_bank_account(unpaid_interest_bank, program_id);
    verify_ubi_bank_account(ubi_bank, program_id);

    // get old days info
    let global_data: &mut GlobalData = global_data_account.try_into().unwrap();

    // get new days info
    let comptoken_mint = Mint::unpack(comptoken_mint_account.try_borrow_data().unwrap().as_ref()).unwrap();

    // calculate interest/high water mark
    let days_supply = comptoken_mint.supply - global_data.old_supply;
    // TODO interest (ensure accuracy)
    let interest_rate = 0;
    let interest = days_supply * interest_rate;
    // announce interest/ water mark/ new Blockhash

    todo!();
    // store data
    mint(global_data_account.key, unpaid_interest_bank.key, interest, accounts)?;

    global_data.old_supply += days_supply + interest;
    //
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
    msg!("acct: {:?}", account);
    msg!("owner: {:?}", owner_key);
    msg!("mint: {:?}", mint.key);
    msg!("rent: {:?}", COMPTOKEN_MINT_ADDRESS);
    let init_comptoken_account_instr = spl_token_2022::instruction::initialize_account3(
        &spl_token_2022::ID,
        &account.key,
        &COMPTOKEN_MINT_ADDRESS,
        &owner_key,
    )?;
    invoke_signed(&init_comptoken_account_instr, &[mint.clone(), account.clone()], signer_seeds)
}

fn store_hash(proof: ComptokenProof, data_account: &AccountInfo) {
    let user_data: &mut UserData = data_account.data.borrow_mut().as_mut().try_into().expect("error already panicked");
    user_data.insert(&proof.hash, &proof.recent_block_hash)
}

fn verify_comptoken_proof_userdata<'a>(
    comptoken_wallet: &'a Pubkey, data: &[u8], valid_blockhash: &Hash,
) -> ComptokenProof<'a> {
    assert_eq!(data.len(), comptoken_proof::VERIFY_DATA_SIZE, "Invalid proof size");
    let proof = ComptokenProof::from_bytes(comptoken_wallet, data.try_into().expect("correct size"));
    msg!("block: {:?}", proof);
    assert!(comptoken_proof::verify_proof(&proof, valid_blockhash), "invalid proof");
    return proof;
}
