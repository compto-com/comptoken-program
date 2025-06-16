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
    instructions::InstructionData,
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

struct CreateUserDataAccountData {
    rent_lamports: u64,
    space: usize,
}

impl InstructionData for CreateUserDataAccountData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if instruction_data.len() != std::mem::size_of::<CreateUserDataAccountData>() {
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }
        let (rent_lamports, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        let (space, instruction_data) =
            get_next_data(instruction_data, 8, |b| usize::from_le_bytes(b.try_into().expect("correct size")));
        assert!(instruction_data.is_empty(), "incorrect instruction data");

        Ok(CreateUserDataAccountData { rent_lamports, space })
    }
}

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

    #[rustfmt::skip]
    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            payer:                        Some(AccountMetaType::SignerAndWritable),
            user_wallet:                  Some(AccountMetaType::Signer),
            user_comptoken_token_account: Some(AccountMetaType::None),
            user_data:                    Some((false, AccountMetaType::Writable)),
            solana_program:               Some(AccountMetaType::None),
            ..Default::default()
        },
    )?;

    let payer_account = verified_accounts.payer.unwrap();
    let user_comptoken_wallet_account = verified_accounts.user_comptoken_token_account.unwrap();
    let user_data_account = verified_accounts.user_data.unwrap();
    let bump = verified_accounts.user_data_bump.unwrap();

    // find space and minimum rent required for account
    let CreateUserDataAccountData { rent_lamports, space } =
        CreateUserDataAccountData::from_instruction_data(instruction_data)?;

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
