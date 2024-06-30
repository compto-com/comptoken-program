mod comptoken_proof;
// mod hash_storage; // coming soon

extern crate bs58;

use comptoken_proof::ComptokenProof;
// use hash_storage::{ErrorAfterSuccess, HashStorage};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    pubkey::Pubkey,
    system_instruction::create_account,
    sysvar::slot_history::ProgramError,
};
use spl_token::instruction::mint_to;
// declare and export the program's entrypoint
entrypoint!(process_instruction);

// MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN test_client.js
const STATIC_ACCOUNT_SPACE: u64 = 4096;

// full_deploy_test.py generates a comptoken_generated.rs
// The first build must not have the testmode feature enabled so that a ProgramId is created.
// full_deploy_test.py handles this case gracefully by building twice on the first usage.
#[cfg(feature = "testmode")]
mod comptoken_generated;
#[cfg(not(feature = "testmode"))]
mod comptoken_generated {
    use solana_program::{pubkey, pubkey::Pubkey};
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
            initialize_static_data_account(program_id, accounts, &instruction_data[1..])
        }
        _ => {
            msg!("Invalid Instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

pub fn initialize_static_data_account(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      owner id
    //      mint authority? pda

    msg!("instruction_data: {:?}", instruction_data);

    let account_info_iter = &mut accounts.iter();
    let owner_account = next_account_info(account_info_iter)?;

    // verify_owner_account(owner_account)?;
    // we do not need to verify that the client provided the correct mint authority
    // if the wrong mint authority is provided, create_account will fail
    let mint_authority_pda = Pubkey::create_program_address(COMPTO_STATIC_PDA_SEEDS, program_id)?;
    let first_8_bytes: [u8; 8] = instruction_data[0..8].try_into().unwrap();
    let lamports = u64::from_be_bytes(first_8_bytes);
    msg!("Lamports: {:?}", lamports);

    let create_acct_instr = create_account(
        owner_account.key,
        &mint_authority_pda,
        lamports,
        STATIC_ACCOUNT_SPACE,
        program_id,
    );
    // let createacct = SystemInstruction::CreateAccount { lamports: (1000), space: (256), owner: *program_id };
    let result = invoke_signed(&create_acct_instr, accounts, &[COMPTO_STATIC_PDA_SEEDS])?;
    // let data = accounts[0].try_borrow_mut_data()?;
    // data[0] = 1;
    Ok(())
}

fn mint(
    mint_pda: &Pubkey,
    destination: &Pubkey,
    amount: u64,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let instruction = mint_to(
        &spl_token::id(),
        &COMPTOKEN_ADDRESS,
        &destination,
        &mint_pda,
        &[&mint_pda],
        amount,
    )?;
    invoke_signed(&instruction, accounts, &[COMPTO_STATIC_PDA_SEEDS])
}

fn verify_comptoken_user_account(account: &AccountInfo) -> ProgramResult {
    // TODO: verify comptoken user accounts
    Ok(())
}

fn verify_comptoken_user_data_account(
    comptoken_user_data_account: &AccountInfo,
    comptoken_user_account: &AccountInfo,
    program_id: &Pubkey,
) {
    // if we ever need a user data account to sign something,
    // then we should return the bumpseed in this function
    assert_eq!(
        *comptoken_user_data_account.key, 
        Pubkey::find_program_address(&[comptoken_user_account.key.as_ref()], program_id).0, 
        "Invalid user data account"
    );
}

pub fn test_mint(
    program_id: &Pubkey,
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
    let token_account = next_account_info(account_info_iter)?;
    let comptoken_account = next_account_info(account_info_iter)?;

    verify_comptoken_user_account(destination_account)?;

    let amount = 2;

    mint(
        mint_authority_account.key,
        destination_account.key,
        amount,
        accounts,
    )
}

fn verify_comptoken_proof_userdata<'a>(
    destination: &'a Pubkey,
    data: &[u8],
) -> ComptokenProof<'a> {
    assert_eq!(data.len(), comptoken_proof::VERIFY_DATA_SIZE, "Invalid proof size");
    let proof = ComptokenProof::from_bytes(destination, data.try_into().expect("correct size"));
    msg!("block: {:?}", proof);
    assert!(comptoken_proof::verify_proof(&proof), "invalid proof");
    return proof;
}

fn store_hash(proof: ComptokenProof, data_account: &AccountInfo) -> ProgramResult {
    // TODO: store hash
    // let hash_storage: &mut HashStorage = data_account.data.borrow_mut().as_mut().try_into()?;
    // match hash_storage.insert(&proof.recent_block_hash, proof.hash, data_account) {
    //     Err(ProgramError::Custom(0)) => {
    //         let hash_storage: &mut HashStorage =
    //             data_account.data.borrow_mut().as_mut().try_into()?;
    //         hash_storage.insert(&proof.recent_block_hash, proof.hash, data_account)
    //     }
    //     Err(E) => Err(E),
    //     Ok(o) => Ok(o),
    // }
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
    //      spl_token account
    //      comptoken program account (writable)

    let account_info_iter = &mut accounts.iter();
    let destination_account = next_account_info(account_info_iter)?;
    let data_account = next_account_info(account_info_iter)?;
    let mint_authority_account = next_account_info(account_info_iter)?;
    let token_account = next_account_info(account_info_iter)?;
    let comptoken_account = next_account_info(account_info_iter)?;

    verify_comptoken_user_account(destination_account)?;
    let proof = verify_comptoken_proof_userdata(destination_account.key, instruction_data);
    verify_comptoken_user_data_account(data_account, destination_account, program_id);

    msg!("data/accounts verified");
    let amount = 2;

    // now save the hash to the account, returning an error if the hash already exists
    store_hash(proof, data_account)?;

    mint(
        mint_authority_account.key,
        &destination_account.key,
        amount,
        accounts,
    )?;

    //todo!("implement minting and storing of hashing");
    Ok(())
}
