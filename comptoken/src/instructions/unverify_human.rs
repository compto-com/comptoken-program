use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    hash::{Hash, HASH_BYTES},
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use comptoken_utils::{user_data::UserData, verify_accounts::VerifiedAccountInfo};

use crate::{
    data::{global_data::GlobalData, nullifier::Nullifier},
    get_next_data,
    instructions::{InstructionAccounts, InstructionData},
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

struct UnverifyHumanData {
    nullifier_hash: Hash,
}

impl InstructionData for UnverifyHumanData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if instruction_data.len() != std::mem::size_of::<UnverifyHumanData>() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let (nullifier_hash, instruction_data) = get_next_data(instruction_data, HASH_BYTES, |b| {
            Hash::new_from_array(b.try_into().expect("slice with incorrect length"))
        });
        assert!(instruction_data.is_empty(), "incorrect instruction data");

        Ok(UnverifyHumanData { nullifier_hash })
    }
}

#[rustfmt::skip]
struct UnverifyHumanAccounts<'a> {
    global_data_account:           VerifiedAccountInfo<'a>,
    _user_wallet:                  VerifiedAccountInfo<'a>,
    _user_comptoken_token_account: VerifiedAccountInfo<'a>,
    user_data_account:             VerifiedAccountInfo<'a>,
    world_id_nullifier:            VerifiedAccountInfo<'a>,
}

impl<'a> InstructionAccounts<'a> for UnverifyHumanAccounts<'a> {
    type AdditionalVerificationData = Hash;

    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, additional_data: Self::AdditionalVerificationData,
    ) -> Result<Self, solana_program::program_error::ProgramError> {
        let nullifier_hash = &additional_data;

        #[rustfmt::skip]
        let verified_accounts = verify_accounts(
            accounts,
            program_id,
            AccountsToVerify {
                global_data_account:          Some(AccountMetaType::Writable),
                user_wallet:                  Some(AccountMetaType::Signer),
                user_comptoken_token_account: Some((true, AccountMetaType::None)),
                user_data_account:            Some((true, AccountMetaType::Writable)),
                world_id_nullifier:           Some((nullifier_hash, AccountMetaType::Writable)),
                ..Default::default()
            },
        )?;

        Ok(UnverifyHumanAccounts {
            global_data_account: verified_accounts.global_data_account.unwrap(),
            _user_wallet: verified_accounts.user_wallet.unwrap(),
            _user_comptoken_token_account: verified_accounts.user_comptoken_token_account.unwrap(),
            user_data_account: verified_accounts.user_data_account.unwrap(),
            world_id_nullifier: verified_accounts.world_id_nullifier.unwrap(),
        })
    }
}

pub fn unverify_human(program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
    //  Account Order
    //      [w] Global Data Account
    //      [s] User Solana Wallet
    //      [] User's Comptoken Token Account
    //      [w] User's Data
    //      [w] World ID Nullifier
    //  Instruction Data
    //      32 bytes - nullifier hash

    let UnverifyHumanData { nullifier_hash } = UnverifyHumanData::from_instruction_data(_instruction_data)?;

    let UnverifyHumanAccounts {
        global_data_account, user_data_account, world_id_nullifier, ..
    } = UnverifyHumanAccounts::verify_accounts(accounts, program_id, nullifier_hash)?;

    assert!(world_id_nullifier.lamports() > 0, "nullifier account does not exist");
    assert_eq!(
        world_id_nullifier.data_len(),
        std::mem::size_of::<Nullifier>(),
        "nullifier account data length is not 32 bytes"
    );
    assert_eq!(world_id_nullifier.owner, program_id, "nullifier account owner does not match world id program");

    let nullifier: &mut Nullifier = (&world_id_nullifier).into();

    assert_eq!(nullifier.account, *user_data_account.key, "nullifier account does not match user data account");

    let user_data: &mut UserData = (&user_data_account).into();
    assert_eq!(nullifier_hash, user_data.nullifier_hash, "nullifier hash does not match user data");

    assert!(user_data.is_current(), "user data account is not current");

    user_data.verification_date = 0;
    user_data.nullifier_hash = Hash::default(); // Clear the nullifier hash
    nullifier.account = Pubkey::default(); // Clear the nullifier account

    let global_data: &mut GlobalData = (&global_data_account).into();
    global_data.daily_distribution_data.stale_verified_humans += 1; // this prevents ubi from being allocated for this user in the future, while preventing more than FUTURE_UBI_VERIFIED_HUMANS from getting extra ubi

    msg!("Successfully unverfied human with World ID");
    Ok(())
}
