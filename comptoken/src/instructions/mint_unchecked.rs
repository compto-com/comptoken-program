use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, msg, program_error::ProgramError, pubkey::Pubkey,
};

#[cfg(feature = "testmode")]
use crate::{
    verify_accounts::verify_accounts,
    verify_accounts::AccountsToVerify,
    {get_next_data, mint},
};

#[cfg(feature = "testmode")]
pub fn mint_unchecked(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Mint Account
    //      [] Comptoken Global Data Account (also Mint Authority)
    //      [s] User Wallet
    //      [] User Comptoken Token Account
    //      [] Solana Token 2022
    //  data:
    //      8 bytes - amount

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            comptoken_mint: Some((false, true)),
            global_data: Some((false, false)),
            user_wallet: Some((true, false)),
            user_comptoken_token_account: Some((false, false)),
            solana_token_2022_program: Some((false, false)),
            ..Default::default()
        },
    )?;

    let comptoken_mint_account = verified_accounts.comptoken_mint.unwrap();
    let global_data_account = verified_accounts.global_data.unwrap();
    let user_comptoken_token_account = verified_accounts.user_comptoken_token_account.unwrap();

    let (amount, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    assert!(instruction_data.is_empty(), "incorrect instruction data");

    mint(
        &global_data_account,
        &user_comptoken_token_account,
        amount,
        &[&comptoken_mint_account, &user_comptoken_token_account, &global_data_account],
    )
}

#[cfg(not(feature = "testmode"))]
pub fn mint_unchecked(_program_id: &Pubkey, _accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
    msg!("Invalid Instruction");
    Err(ProgramError::InvalidInstructionData)
}
