
extern crate bs58;

use solana_program::{
    account_info::{AccountInfo, next_account_info},
    entrypoint,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
    msg,
    pubkey,
    program::invoke_signed,
    sysvar,
    hash::Hash,
    // sysvar::{slot_hashes::SlotHashes, Sysvar},
};
use spl_token::instruction::mint_to;
// declare and export the program's entrypoint
entrypoint!(process_instruction);

// vvv This line is automatically updated by full_deploy_test.py. Do not change this without updating the script. vvv 
static COMPTO_TOKEN_ADDRESS: Pubkey = pubkey!("5J22ivtwyf2ysuAN3ddepB3aSSjYTQzLWVLwcHesq2qd");

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
        mint_comptokens(program_id, accounts, &instruction_data[1..])?;
        return Ok(());
    } else {
        msg!("Invalid Instruction");
        return Ok(());
    }
} 

// struct ComptokenMintProof {
//     sh
// }
pub fn mint_comptokens(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8]
) -> ProgramResult {
    assert_eq!(accounts[0].key, &sysvar::slot_hashes::id(), "Invalid SlotHashes account");
    let data = accounts[0].try_borrow_data()?;
    let hash = Hash::new(&data[8..40]);
    msg!("Hash: {:?}", hash);
    Ok(())
}



// test mint function
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
    let bump: [u8; 1] = [instruction_data[0]];
    let mint_pda = Pubkey::create_program_address(&[b"compto", &bump], &program_id)?;
    msg!("Mint PDA: {:?}", mint_pda);
    let mint_to_instruction = mint_to(
        &spl_token::id(),
        &COMPTO_TOKEN_ADDRESS,
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
        &[&[b"compto", &bump]]  
    )?;
    // msg!("Result: {:?}", result);
    // gracefully exit the program
    Ok(())
}