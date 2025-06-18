use solana_program::{
    hash::HASH_BYTES,
    {account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey},
};

use comptoken_utils::{
    create_pda,
    user_data::{UserData, USER_DATA_MIN_SIZE},
    verify_accounts::VerifiedAccountInfo,
};

use crate::{
    get_next_data,
    instructions::{InstructionAccounts, InstructionData},
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

#[rustfmt::skip]
struct CreateUserDataAccountAccounts<'a> {
    payer:                        VerifiedAccountInfo<'a>,
    _user_wallet:                 VerifiedAccountInfo<'a>,
    user_comptoken_token_account: VerifiedAccountInfo<'a>,
    user_data_account:            VerifiedAccountInfo<'a>,
    user_data_account_bump:       u8,
    _solana_program:              VerifiedAccountInfo<'a>,
}

impl<'a> InstructionAccounts<'a> for CreateUserDataAccountAccounts<'a> {
    type AdditionalVerificationData = ();

    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, _additional_data: Self::AdditionalVerificationData,
    ) -> Result<Self, solana_program::program_error::ProgramError> {
        #[rustfmt::skip]
        let verified_accounts = verify_accounts(
            accounts,
            program_id,
            AccountsToVerify {
                payer:                        Some(AccountMetaType::SignerAndWritable),
                user_wallet:                  Some(AccountMetaType::Signer),
                user_comptoken_token_account: Some((true, AccountMetaType::None)),
                user_data_account:            Some((false, AccountMetaType::Writable)),
                solana_program:               Some(AccountMetaType::None),
                ..Default::default()
            },
        )?;

        Ok(CreateUserDataAccountAccounts {
            payer: verified_accounts.payer.unwrap(),
            _user_wallet: verified_accounts.user_wallet.unwrap(),
            user_comptoken_token_account: verified_accounts.user_comptoken_token_account.unwrap(),
            user_data_account: verified_accounts.user_data_account.unwrap(),
            user_data_account_bump: verified_accounts.user_data_account_bump.unwrap(),
            _solana_program: verified_accounts.solana_program.unwrap(),
        })
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

    let CreateUserDataAccountAccounts {
        payer,
        user_comptoken_token_account,
        user_data_account,
        user_data_account_bump,
        ..
    } = CreateUserDataAccountAccounts::verify_accounts(accounts, program_id, ())?;

    let CreateUserDataAccountData { rent_lamports, space } =
        CreateUserDataAccountData::from_instruction_data(instruction_data)?;

    msg!("space: {}", space);
    assert!(space >= USER_DATA_MIN_SIZE);
    assert!((space - USER_DATA_MIN_SIZE) % HASH_BYTES == 0);

    create_pda(
        &payer,
        &user_data_account,
        rent_lamports,
        space as u64,
        program_id,
        &[&[user_comptoken_token_account.key.as_ref(), &[user_data_account_bump]]],
    )?;

    // initialize data account
    let user_data: &mut UserData = (&user_data_account).into();
    user_data.initialize();

    Ok(())
}
