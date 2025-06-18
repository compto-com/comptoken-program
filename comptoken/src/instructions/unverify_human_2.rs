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
    constants::WORLD_PROOF_LENGTH,
    data::{global_data::GlobalData, nullifier::Nullifier},
    get_next_data,
    instructions::{verify, InstructionAccounts, InstructionData, WorldIdVerifyAccounts},
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

struct UnverifyHuman2Data {
    root_hash: Hash,
    nullifier_hash: Hash,
    proof: [u8; WORLD_PROOF_LENGTH],
}

impl InstructionData for UnverifyHuman2Data {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if instruction_data.len() != std::mem::size_of::<UnverifyHuman2Data>() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let (root_hash, instruction_data) = get_next_data(instruction_data, HASH_BYTES, |b| {
            Hash::new_from_array(b.try_into().expect("slice with incorrect length"))
        });
        let (nullifier_hash, instruction_data) = get_next_data(instruction_data, HASH_BYTES, |b| {
            Hash::new_from_array(b.try_into().expect("slice with incorrect length"))
        });
        let (proof, instruction_data) =
            get_next_data(instruction_data, WORLD_PROOF_LENGTH, |b| b.try_into().expect("slice with incorrect length"));
        assert!(instruction_data.is_empty(), "incorrect instruction data");

        Ok(UnverifyHuman2Data { root_hash, nullifier_hash, proof })
    }
}

#[rustfmt::skip]
struct UnverifyHuman2Accounts<'a> {
    global_data_account:          VerifiedAccountInfo<'a>,
    user_comptoken_token_account: VerifiedAccountInfo<'a>,
    user_data_account:            VerifiedAccountInfo<'a>,
    world_id_program:             VerifiedAccountInfo<'a>,
    world_id_root:                VerifiedAccountInfo<'a>,
    world_id_latest_root:         VerifiedAccountInfo<'a>,
    world_id_config:              VerifiedAccountInfo<'a>,
    world_id_nullifier:           VerifiedAccountInfo<'a>,
}

impl<'a> InstructionAccounts<'a> for UnverifyHuman2Accounts<'a> {
    type AdditionalVerificationData = (Hash, Hash); // root_hash, nullifier_hash

    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, additional_data: Self::AdditionalVerificationData,
    ) -> Result<Self, solana_program::program_error::ProgramError> {
        let (root_hash, nullifier_hash) = &additional_data;

        #[rustfmt::skip]
        let verified_accounts = verify_accounts(
            accounts,
            program_id,
            AccountsToVerify {
                global_data_account:          Some(AccountMetaType::Writable),
                user_comptoken_token_account: Some((false, AccountMetaType::Writable)),
                user_data_account:            Some((true, AccountMetaType::Writable)),
                world_id_program:             Some(AccountMetaType::None),
                world_id_root:                Some((root_hash, AccountMetaType::None)),
                world_id_latest_root:         Some(AccountMetaType::None),
                world_id_config:              Some(AccountMetaType::None),
                world_id_nullifier:           Some((nullifier_hash, AccountMetaType::Writable)),
                ..Default::default()
            },
        )?;

        Ok(UnverifyHuman2Accounts {
            global_data_account: verified_accounts.global_data_account.unwrap(),
            user_comptoken_token_account: verified_accounts.user_comptoken_token_account.unwrap(),
            user_data_account: verified_accounts.user_data_account.unwrap(),
            world_id_program: verified_accounts.world_id_program.unwrap(),
            world_id_root: verified_accounts.world_id_root.unwrap(),
            world_id_latest_root: verified_accounts.world_id_latest_root.unwrap(),
            world_id_config: verified_accounts.world_id_config.unwrap(),
            world_id_nullifier: verified_accounts.world_id_nullifier.unwrap(),
        })
    }
}

pub fn unverify_human_2(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  Account Order
    //      [w] Global Data Account
    //      [] User's Comptoken Token Account
    //      [w] User's Data
    //      [] World ID Program
    //      [] World ID Root
    //      [] World ID Latest Root
    //      [] World ID Config
    //      [w] World ID Nullifier
    // data:
    //      32 bytes - root hash
    //      32 bytes - nullifier hash
    //      256 bytes - proof

    let UnverifyHuman2Data { root_hash, nullifier_hash, proof } =
        UnverifyHuman2Data::from_instruction_data(instruction_data)?;

    let UnverifyHuman2Accounts {
        global_data_account,
        user_comptoken_token_account,
        user_data_account,
        world_id_program,
        world_id_root,
        world_id_latest_root,
        world_id_config,
        world_id_nullifier,
    } = UnverifyHuman2Accounts::verify_accounts(accounts, program_id, (root_hash, nullifier_hash))?;

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

    verify(
        WorldIdVerifyAccounts {
            user_comptoken_token_account,
            world_id_program,
            world_id_root,
            world_id_latest_root,
            world_id_config,
        },
        &root_hash,
        &nullifier_hash,
        &proof,
    )?;

    user_data.verification_date = 0;
    user_data.nullifier_hash = Hash::default(); // Clear the nullifier hash
    nullifier.account = Pubkey::default(); // Clear the nullifier account

    let global_data: &mut GlobalData = (&global_data_account).into();
    global_data.daily_distribution_data.stale_verified_humans += 1; // this prevents ubi from being allocated for this user in the future, while preventing more than FUTURE_UBI_VERIFIED_HUMANS from getting extra ubi

    msg!("Successfully unverfied human with World ID");
    Ok(())
}
