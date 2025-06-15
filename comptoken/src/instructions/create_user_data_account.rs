use solana_program::{
    hash::HASH_BYTES,
    {account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey},
};

use comptoken_utils::{
    create_pda,
    user_data::{UserData, USER_DATA_MIN_SIZE},
};

use crate::{
    get_next_data,
    verify_accounts::{verify_accounts, AccountsToVerify},
};

pub fn create_user_data_account(
    program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8],
) -> ProgramResult {
    //  Account Order
    //      [s, w] payer account
    //      [s] User Solana Wallet
    //      [] User's Comptoken Token Account
    //      [w] User's Data Account
    //      [] Solana Program
    //  data:
    //      8 bytes - rent lamports
    //      8 bytes - space

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            payer: Some((true, true)),
            user_wallet: Some((true, false)),
            user_comptoken_token_account: Some((false, false)),
            user_data: Some((false, (false, true))),
            solana_program: Some((false, false)),
            ..Default::default()
        },
    )?;

    let payer_account = verified_accounts.payer.unwrap();
    let user_comptoken_wallet_account = verified_accounts.user_comptoken_token_account.unwrap();
    let user_data_account = verified_accounts.user_data.unwrap();
    let bump = verified_accounts.user_data_bump.unwrap();

    // find space and minimum rent required for account
    let (rent_lamports, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    let (space, instruction_data) =
        get_next_data(instruction_data, 8, |b| usize::from_le_bytes(b.try_into().expect("correct size")));
    assert!(instruction_data.is_empty(), "incorrect instruction data");

    msg!("space: {}", space);
    assert!(space >= USER_DATA_MIN_SIZE);
    assert!((space - USER_DATA_MIN_SIZE) % HASH_BYTES == 0);

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
