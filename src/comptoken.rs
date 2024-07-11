mod comptoken_proof;
mod global_data;
mod user_data_storage;

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
        system_instruction::create_account,
        sysvar::slot_history::ProgramError,
    },
    state::Mint,
};

use comptoken_proof::ComptokenProof;
use global_data::GlobalData;
use user_data_storage::{ProofStorage, PROOF_STORAGE_MIN_SIZE};

// declare and export the program's entrypoint
entrypoint!(process_instruction);

type ProgramResult = Result<(), ProgramError>;

// MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN test_client.js
const STATIC_ACCOUNT_SPACE: u64 = 4096;

// full_deploy_test.py generates a comptoken_generated.rs
// The first build must not have the testmode feature enabled so that a ProgramId is created.
// full_deploy_test.py handles this case gracefully by building twice on the first usage.
#[cfg(feature = "testmode")]
mod comptoken_generated;
#[cfg(not(feature = "testmode"))]
mod comptoken_generated {
    use spl_token_2022::solana_program::{pubkey, pubkey::Pubkey};
    pub const COMPTOKEN_ADDRESS: Pubkey = pubkey!("11111111111111111111111111111111");
    pub const COMPTO_STATIC_ADDRESS_SEED: u8 = 255;
}
use comptoken_generated::{COMPTOKEN_ADDRESS, COMPTO_STATIC_ADDRESS_SEED};

const COMPTO_STATIC_PDA_SEEDS: &[&[u8]] = &[&[COMPTO_STATIC_ADDRESS_SEED]];

// #[derive(Debug, Default, BorshDeserialize, BorshSerialize)]
// pub struct DataAccount {
//     pub hash: [u8; 32], // Assuming you want to store a 32-byte hash
// }

// program entrypoint's implementation
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
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

pub fn create_global_data_account(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      payer id
    //      Static Data Account (also mint authority)

    msg!("instruction_data: {:?}", instruction_data);

    let account_info_iter = &mut accounts.iter();
    let owner_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let global_data_account_pubkey =
        Pubkey::create_program_address(COMPTO_STATIC_PDA_SEEDS, program_id)?;
    // necessary because we use the user provided pubkey to retrieve the data
    assert_eq!(global_data_account_pubkey, *global_data_account.key);
    let first_8_bytes: [u8; 8] = instruction_data[0..8].try_into().unwrap();
    let lamports = u64::from_be_bytes(first_8_bytes);
    msg!("Lamports: {:?}", lamports);

    let create_acct_instr = create_account(
        owner_account.key,
        &global_data_account_pubkey,
        lamports,
        STATIC_ACCOUNT_SPACE,
        program_id,
    );
    let _result = invoke_signed(&create_acct_instr, accounts, &[COMPTO_STATIC_PDA_SEEDS])?;
    let global_data: &mut GlobalData = global_data_account.try_into().unwrap();
    global_data.initialize();
    Ok(())
}

fn mint(
    mint_pda: &Pubkey,
    destination: &Pubkey,
    amount: u64,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let instruction = mint_to(
        &spl_token_2022::id(),
        &COMPTOKEN_ADDRESS,
        &destination,
        &mint_pda,
        &[&mint_pda],
        amount,
    )?;
    invoke_signed(&instruction, accounts, &[COMPTO_STATIC_PDA_SEEDS])
}

fn verify_comptoken_user_account(_account: &AccountInfo) -> ProgramResult {
    // TODO: verify comptoken user accounts
    Ok(())
}

fn verify_comptoken_user_data_account(
    comptoken_user_data_account: &AccountInfo,
    comptoken_user_account: &AccountInfo,
    program_id: &Pubkey,
) -> u8 {
    // if we ever need a user data account to sign something,
    // then we should return the bumpseed in this function
    let (pda, bump) =
        Pubkey::find_program_address(&[comptoken_user_account.key.as_ref()], program_id);
    assert_eq!(
        *comptoken_user_data_account.key, pda,
        "Invalid user data account"
    );
    bump
}

pub fn test_mint(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      destination comptoken account
    //      mint authority account
    //      spl_token account
    //      comptoken program account

    msg!("instruction_data: {:?}", instruction_data);
    for account_info in accounts.iter() {
        msg!("Public Key: {:?}", account_info.key);
    }

    let account_info_iter = &mut accounts.iter();
    let destination_account = next_account_info(account_info_iter)?;
    let mint_authority_account = next_account_info(account_info_iter)?;
    let _token_account = next_account_info(account_info_iter)?;
    let _comptoken_account = next_account_info(account_info_iter)?;

    verify_comptoken_user_account(destination_account)?;

    let amount = 2;

    mint(
        mint_authority_account.key,
        destination_account.key,
        amount,
        accounts,
    )
}

fn verify_comptoken_proof_userdata<'a>(destination: &'a Pubkey, data: &[u8]) -> ComptokenProof<'a> {
    assert_eq!(
        data.len(),
        comptoken_proof::VERIFY_DATA_SIZE,
        "Invalid proof size"
    );
    let proof = ComptokenProof::from_bytes(destination, data.try_into().expect("correct size"));
    msg!("block: {:?}", proof);
    assert!(comptoken_proof::verify_proof(&proof), "invalid proof");
    return proof;
}

fn get_valid_hash<'a>() -> &'a Hash {
    // TODO: implement
    static VALID_HASH: Hash = Hash::new_from_array([0; 32]);
    &VALID_HASH
}

fn store_hash(proof: ComptokenProof, data_account: &AccountInfo) {
    let proof_storage: &mut ProofStorage = data_account
        .data
        .borrow_mut()
        .as_mut()
        .try_into()
        .expect("error already panicked");
    proof_storage.insert(&proof.hash, &proof.recent_block_hash)
}

pub fn create_user_data_account(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    //  Account Order
    //      users account
    //      users Comptoken wallet
    //      users Comptoken wallet's data account
    //      System Program id

    let account_info_iter = &mut accounts.iter();

    let payer_account_info = next_account_info(account_info_iter)?;
    let destination_account = next_account_info(account_info_iter)?;
    let data_account_info = next_account_info(account_info_iter)?;

    // find space and minimum rent required for account
    let rent_lamports =
        u64::from_le_bytes(instruction_data[0..8].try_into().expect("correct size"));
    let space = usize::from_le_bytes(instruction_data[8..16].try_into().expect("correct size"));
    msg!("space: {}", space);
    assert!(space >= PROOF_STORAGE_MIN_SIZE);
    assert!((space - PROOF_STORAGE_MIN_SIZE) % HASH_BYTES == 0);

    let bump =
        verify_comptoken_user_data_account(data_account_info, destination_account, program_id);

    invoke_signed(
        &spl_token_2022::solana_program::system_instruction::create_account(
            &payer_account_info.key,
            &data_account_info.key,
            rent_lamports,
            space.try_into().expect("correct size"),
            program_id,
        ),
        &[payer_account_info.clone(), data_account_info.clone()],
        &[&[&destination_account.key.as_ref(), &[bump]]],
    )?;

    // initialize data account
    let mut binding = data_account_info.try_borrow_mut_data()?;
    let data = binding.as_mut();

    let proof_storage: &mut ProofStorage = data.try_into().expect("panicked already");
    proof_storage.initialize();

    Ok(())
}

pub fn mint_comptokens(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      destination token account (writable)
    //      destination data account (writable)
    //      mint authority account
    //      spl_token 2022 account
    //      comptoken program account (writable)

    let account_info_iter = &mut accounts.iter();
    let destination_account = next_account_info(account_info_iter)?;
    let data_account = next_account_info(account_info_iter)?;
    let mint_authority_account = next_account_info(account_info_iter)?;
    //let token_account = next_account_info(account_info_iter)?;
    //let comptoken_account = next_account_info(account_info_iter)?;

    verify_comptoken_user_account(destination_account)?;
    let proof = verify_comptoken_proof_userdata(destination_account.key, instruction_data);
    let _ = verify_comptoken_user_data_account(data_account, destination_account, program_id);

    msg!("data/accounts verified");
    let amount = 2;
    // now save the hash to the account, returning an error if the hash already exists
    store_hash(proof, data_account);
    msg!("stored the proof");
    mint(
        mint_authority_account.key,
        &destination_account.key,
        amount,
        accounts,
    )?;

    //todo!("implement minting and storing of hashing");
    Ok(())
}

// under construction
pub fn daily_distribution_event(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      Comptoken Mint Acct (not mint authority)
    //      Comptoken Static Data Acct (also mint authority)
    //      Comptoken Static Bank Acct

    let account_info_iter = &mut accounts.iter();
    let comptoken_mint_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let unpaid_interest_bank = next_account_info(account_info_iter)?;

    // get old days info
    let global_data: &mut GlobalData = global_data_account.try_into().unwrap();

    // get new days info
    let comptoken_mint =
        Mint::unpack(comptoken_mint_account.try_borrow_data().unwrap().as_ref()).unwrap();

    // calculate interest/high water mark
    let days_supply = comptoken_mint.supply - global_data.old_supply;
    // TODO interest (ensure accuracy)
    let interest_rate = 0;
    let interest = days_supply * interest_rate;
    // announce interest/ water mark/ new Blockhash

    todo!();
    // store data
    mint(
        global_data_account.key,
        unpaid_interest_bank.key,
        interest,
        accounts,
    )?;

    global_data.old_supply += days_supply + interest;
    //
}
