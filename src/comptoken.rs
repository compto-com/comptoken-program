
extern crate bs58;

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
    msg,
    pubkey,
    program::invoke_signed,
    sysvar,
    hash::Hash,
    system_instruction::create_account,
    // sysvar::{slot_hashes::SlotHashes, Sysvar},
};
use spl_token::instruction::mint_to;
use hex::encode;
// declare and export the program's entrypoint
entrypoint!(process_instruction);

// vvv This line is automatically updated by full_deploy_test.py.
static COMPTOKEN_ADDRESS: Pubkey = pubkey!("oNe7WCf3bD1J5t84YBCQFbo1Q5c24iMYgbx5vqHbeLw");
// ^^^ DO NOT TOUCH. ^^^

// A given seed and program id have a 50% chance of creating a valid PDA.
// Before building/deploying, we find the canonical seed by running 
//      `solana find-program-derived-address <program_id>`
// This is an efficiency optimization. We are using a static seed to create the PDA with no bump.
// We ensure when deploying that the program id is one that only needs the seed above and no bump.
// This is because 
//      (1) create_program_address is not safe if using a user provided bump.
//      (2) find_program_address is expensive and we want to avoid iterations.
// vvv This line is automatically updated by full_deploy_test.py.
static COMPTO_STATIC_ADDRESS_SEED: u8 = 255;
// ^^^ DO NOT TOUCH. ^^^


// #[derive(Debug, Default, BorshDeserialize, BorshSerialize)]
// pub struct DataAccount {
//     pub hash: [u8; 32], // Assuming you want to store a 32-byte hash
// }

// program entrypoint's implementation
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8]
) -> ProgramResult {
    msg!("instruction_data: {:?}", instruction_data);
    if instruction_data[0] == 0 {
        msg!("Test Mint");
        return test_mint(program_id, accounts, &instruction_data[1..]);
    } else if instruction_data[0] == 1 {
        msg!("Mint New Comptokens");
        return mint_comptokens(program_id, accounts, &instruction_data[1..]);
    } else if instruction_data[0] == 2 {
        msg!("Initialize Static Data Account");
        return initialize_static_data_account(program_id, accounts, &instruction_data[1..]);
    } else {
        msg!("Invalid Instruction");
        return Ok(());
    }
} 


pub fn initialize_static_data_account(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8]
) -> ProgramResult {
    let mint_pda = Pubkey::create_program_address(&[&[COMPTO_STATIC_ADDRESS_SEED]], &program_id)?;
    assert_eq!(accounts[0].key, &mint_pda, "Invalid Mint PDA account.");

    msg!("instruction_data: {:?}", instruction_data);

    // let initialize_account_instruction = 
    let first_8_bytes: [u8; 8] = instruction_data[0..8].try_into().unwrap();
    let lamports = u64::from_le_bytes(first_8_bytes);
    msg!("Lamports: {:?}", lamports);
    let create_acct_instr = create_account(
        accounts[1].key,
        &mint_pda,
        lamports,
        // MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN test_client.js
        4096,
        program_id
    );
    // let createacct = SystemInstruction::CreateAccount { lamports: (1000), space: (256), owner: *program_id };
    let result = invoke_signed(
        &create_acct_instr, 
        accounts,
        &[&[&[COMPTO_STATIC_ADDRESS_SEED]]]
    )?;
    // let data = accounts[0].try_borrow_mut_data()?;
    // data[0] = 1;
    Ok(())
}

// struct ComptokenMintProof {
//     sh
// }


pub fn test_mint(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8]
) -> ProgramResult {
    msg!("instruction_data: {:?}", instruction_data);
    let amount = 2;
    for account_info in accounts.iter() {
        msg!("Public Key: {:?}", account_info.key);
    }
    let destination_pubkey = accounts[0].key;
    // Create the mint_to instruction
    let mint_pda = Pubkey::create_program_address(&[&[COMPTO_STATIC_ADDRESS_SEED]], &program_id)?;
    msg!("Mint PDA: {:?}", mint_pda);
    // msg!("bump: {:?}", bump);
    let mint_to_instruction = mint_to(
        &spl_token::id(),
        &COMPTOKEN_ADDRESS,
        &destination_pubkey,
        &mint_pda,
        &[&mint_pda],
        amount,
    )?;
    // accounts.push(AccountInfo::new(&mint_pda, true, true));
    // Invoke the token program
    let result = invoke_signed(
        &mint_to_instruction, 
        accounts,
        &[&[&[COMPTO_STATIC_ADDRESS_SEED]]]
    )?;
    // msg!("Result: {:?}", result);
    // gracefully exit the program
    Ok(())
}

pub fn mint_comptokens(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8]
) -> ProgramResult {
    // this nonce is what the miner increments to find a valid proof
    // let nonce = instruction_data[..32].try_into().unwrap();
    // verify_proof(accounts[1].key, nonce);
    
    
    
    // get_pseudo_random();

    assert_eq!(accounts[0].key, &sysvar::slot_hashes::id(), "Invalid SlotHashes account.");
    let data = accounts[0].try_borrow_data()?;
    let hash = Hash::new(&data[16..48]);
    msg!("Hash: {:?}", hash);
    // now save the hash to the account

    // let mint_pda = Pubkey::create_program_address(&[&[COMPTO_STATIC_ADDRESS_SEED]], &program_id)?;
    // let mut pda_data = mint_pda.try_borrow_mut_data()?;
    // pda_data[0].copy_from_slice(instruction_data[0]);
    // msg!("data: {:?}", encode(&data[..64]));
    Ok(())
}