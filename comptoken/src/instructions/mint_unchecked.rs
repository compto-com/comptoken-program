#[cfg(feature = "testmode")]
mod mint_unchecked_impl {
    use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

    use comptoken_utils::verify_accounts::VerifiedAccountInfo;

    use crate::{
        instructions::{InstructionAccounts, InstructionData},
        verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
        {get_next_data, mint},
    };

    struct MintUncheckedData {
        amount: u64,
    }

    impl InstructionData for MintUncheckedData {
        fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
            if instruction_data.len() != std::mem::size_of::<MintUncheckedData>() {
                return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
            }
            let (amount, instruction_data) =
                get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
            assert!(instruction_data.is_empty(), "incorrect instruction data");

            Ok(MintUncheckedData { amount })
        }
    }

    #[rustfmt::skip]
    struct MintUncheckedAccounts<'a> {
        comptoken_mint:               VerifiedAccountInfo<'a>,
        global_data_account:          VerifiedAccountInfo<'a>,
        _user_wallet:                 VerifiedAccountInfo<'a>,
        user_comptoken_token_account: VerifiedAccountInfo<'a>,
        _solana_token_2022_program:   VerifiedAccountInfo<'a>,
    }

    impl<'a> InstructionAccounts<'a> for MintUncheckedAccounts<'a> {
        type AdditionalVerificationData = ();

        fn verify_accounts(
            accounts: &[AccountInfo<'a>], program_id: &Pubkey, _additional_data: Self::AdditionalVerificationData,
        ) -> Result<Self, solana_program::program_error::ProgramError> {
            #[rustfmt::skip]
            let verified_accounts = verify_accounts(
                accounts,
                program_id,
                AccountsToVerify {
                    comptoken_mint:               Some(AccountMetaType::Writable),
                    global_data_account:          Some(AccountMetaType::None),
                    user_wallet:                  Some(AccountMetaType::Signer),
                    user_comptoken_token_account: Some((true, AccountMetaType::None)),
                    solana_token_2022_program:    Some(AccountMetaType::None),
                    ..Default::default()
                },
            )?;

            Ok(MintUncheckedAccounts {
                comptoken_mint: verified_accounts.comptoken_mint.unwrap(),
                global_data_account: verified_accounts.global_data_account.unwrap(),
                _user_wallet: verified_accounts.user_wallet.unwrap(),
                user_comptoken_token_account: verified_accounts.user_comptoken_token_account.unwrap(),
                _solana_token_2022_program: verified_accounts.solana_token_2022_program.unwrap(),
            })
        }
    }

    pub fn mint_unchecked(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
        //  accounts order:
        //      [w] Comptoken Mint Account
        //      [] Comptoken Global Data Account (also Mint Authority)
        //      [s] User Wallet
        //      [] User Comptoken Token Account
        //      [] Solana Token 2022
        //  data:
        //      8 bytes - amount

        let MintUncheckedAccounts {
            comptoken_mint,
            global_data_account,
            user_comptoken_token_account,
            ..
        } = MintUncheckedAccounts::verify_accounts(accounts, program_id, ())?;

        let MintUncheckedData { amount } = MintUncheckedData::from_instruction_data(instruction_data)?;

        mint(
            &global_data_account,
            &user_comptoken_token_account,
            amount,
            &[&comptoken_mint, &user_comptoken_token_account, &global_data_account],
        )
    }
}

#[cfg(not(feature = "testmode"))]
mod mint_unchecked_impl {
    use solana_program::{
        account_info::AccountInfo, entrypoint::ProgramResult, msg, program_error::ProgramError, pubkey::Pubkey,
    };

    pub fn mint_unchecked(_program_id: &Pubkey, _accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
        msg!("Minting is disabled in non-test mode");
        Err(ProgramError::InvalidInstructionData)
    }
}

pub use mint_unchecked_impl::mint_unchecked;
