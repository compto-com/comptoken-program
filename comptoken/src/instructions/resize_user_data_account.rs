use solana_program::{
    account_info::AccountInfo,
    entrypoint::{ProgramResult, MAX_PERMITTED_DATA_INCREASE},
    hash::HASH_BYTES,
    pubkey::Pubkey,
};

use comptoken_utils::{invoke_signed_verified, user_data::USER_DATA_MIN_SIZE};

use crate::{
    get_next_data,
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

struct ResizeUserDataAccountData {
    rent_lamports: u64,
    new_size: usize,
}

impl ResizeUserDataAccountData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if instruction_data.len() != std::mem::size_of::<ResizeUserDataAccountData>() {
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }
        let (rent_lamports, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        let (new_size, instruction_data) =
            get_next_data(instruction_data, 8, |b| usize::from_le_bytes(b.try_into().expect("correct size")));
        assert!(instruction_data.is_empty(), "incorrect instruction data");

        Ok(ResizeUserDataAccountData { rent_lamports, new_size })
    }
}

pub fn resize_user_data(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  Account Order
    //      [s, w] Payer Account
    //      [s] User Solana Wallet
    //      [] User's Comptoken Token Account
    //      [w] User's Data
    //      [] Solana Program
    //  data:
    //      8 bytes - rent lamports
    //      8 bytes - new size

    #[rustfmt::skip]
    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            payer:                        Some(AccountMetaType::SignerAndWritable),
            user_wallet:                  Some(AccountMetaType::Signer),
            user_comptoken_token_account: Some(AccountMetaType::None),
            user_data:                    Some((true, AccountMetaType::Writable)),
            solana_program:               Some(AccountMetaType::None),
            ..Default::default()
        },
    )?;

    let payer_account = verified_accounts.payer.unwrap();
    let user_data_account = verified_accounts.user_data.unwrap();
    let system_program = verified_accounts.solana_program.unwrap();

    // find space and minimum rent required for account
    let ResizeUserDataAccountData { rent_lamports, new_size } =
        ResizeUserDataAccountData::from_instruction_data(instruction_data)?;

    // SAFETY: user_data_account is passed in from the runtime and is guaranteed to uphold the invariants original_data_len() and realloc assumes
    assert!(new_size <= unsafe { user_data_account.original_data_len() } + MAX_PERMITTED_DATA_INCREASE);
    assert!(user_data_account.data_len() < new_size);
    assert!((new_size - USER_DATA_MIN_SIZE) % HASH_BYTES == 0);
    let lamports = rent_lamports.saturating_sub(user_data_account.lamports());

    invoke_signed_verified(
        &solana_system_interface::instruction::transfer(payer_account.key, user_data_account.key, lamports),
        &[&user_data_account, &payer_account, &system_program],
        &[],
    )?;
    user_data_account.resize(new_size)
}
