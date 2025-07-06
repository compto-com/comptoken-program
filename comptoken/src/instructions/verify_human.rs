use ethnum::u256;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    hash::{Hash, HASH_BYTES},
    instruction::{AccountMeta, Instruction},
    keccak, msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use spl_token_2022::{extension::StateWithExtensions, state::Account};

use comptoken_utils::{
    user_data::UserData,
    verify_accounts::VerifiedAccountInfo,
    {create_pda, get_current_time, invoke_verified, normalize_time},
};

use crate::{
    constants::{FUTURE_UBI_VERIFIED_HUMANS, SOLANA_WORLD_ID_PROGRAM, WORLD_PROOF_LENGTH, WORLD_VERIFICATION_TYPE},
    data::{global_data::GlobalData, nullifier::Nullifier},
    instructions::{InstructionAccounts, InstructionData},
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
    {get_next_data, transfer},
};

struct VerifyHumanData {
    rent_lamports: u64,
    root_hash: Hash,
    nullifier_hash: Hash,
    proof: [u8; WORLD_PROOF_LENGTH],
}

impl InstructionData for VerifyHumanData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if instruction_data.len() != std::mem::size_of::<VerifyHumanData>() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let (rent_lamports, instruction_data) =
            get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
        let (root_hash, instruction_data) = get_next_data(instruction_data, HASH_BYTES, |b| {
            Hash::new_from_array(b.try_into().expect("slice with incorrect length"))
        });
        let (nullifier_hash, instruction_data) = get_next_data(instruction_data, HASH_BYTES, |b| {
            Hash::new_from_array(b.try_into().expect("slice with incorrect length"))
        });
        let (proof, instruction_data) =
            get_next_data(instruction_data, WORLD_PROOF_LENGTH, |b| b.try_into().expect("slice with incorrect length"));
        assert!(instruction_data.is_empty(), "incorrect instruction data");

        Ok(VerifyHumanData { rent_lamports, root_hash, nullifier_hash, proof })
    }
}

#[rustfmt::skip]
struct VerifyHumanAccounts<'a> {
    payer:                               VerifiedAccountInfo<'a>,
    comptoken_program:                   VerifiedAccountInfo<'a>,
    comptoken_mint:                      VerifiedAccountInfo<'a>,
    global_data_account:                 VerifiedAccountInfo<'a>,
    unpaid_future_ubi_bank:              VerifiedAccountInfo<'a>,
    unpaid_future_ubi_bank_data_account: VerifiedAccountInfo<'a>,
    _user_wallet:                        VerifiedAccountInfo<'a>,
    user_comptoken_token_account:        VerifiedAccountInfo<'a>,
    user_data_account:                   VerifiedAccountInfo<'a>,
    transfer_hook_program:               VerifiedAccountInfo<'a>,
    extra_account_metas:                 VerifiedAccountInfo<'a>,
    world_id_program:                    VerifiedAccountInfo<'a>,
    world_id_root:                       VerifiedAccountInfo<'a>,
    world_id_latest_root:                VerifiedAccountInfo<'a>,
    world_id_config:                     VerifiedAccountInfo<'a>,
    world_id_nullifier:                  VerifiedAccountInfo<'a>,
    world_id_nullifier_bump:             u8,
}

impl<'a> InstructionAccounts<'a> for VerifyHumanAccounts<'a> {
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
                payer:                               Some(AccountMetaType::SignerAndWritable),
                comptoken_program:                   Some(AccountMetaType::None),
                comptoken_mint:                      Some(AccountMetaType::None),
                global_data_account:                 Some(AccountMetaType::Writable),
                unpaid_future_ubi_bank:              Some(AccountMetaType::Writable),
                unpaid_future_ubi_bank_data_account: Some(AccountMetaType::None),
                user_wallet:                         Some(AccountMetaType::Signer),
                user_comptoken_token_account:        Some((true, AccountMetaType::Writable)),
                user_data_account:                   Some((true, AccountMetaType::Writable)),
                transfer_hook_program:               Some(AccountMetaType::None),
                extra_account_metas:                 Some(AccountMetaType::None),
                world_id_program:                    Some(AccountMetaType::None),
                world_id_root:                       Some((root_hash, AccountMetaType::None)),
                world_id_latest_root:                Some(AccountMetaType::None),
                world_id_config:                     Some(AccountMetaType::None),
                world_id_nullifier:                  Some((nullifier_hash, AccountMetaType::Writable)),
                solana_program:                      Some(AccountMetaType::None),
                solana_token_2022_program:           Some(AccountMetaType::None),
                ..Default::default()
            },
        )?;

        Ok(VerifyHumanAccounts {
            payer: verified_accounts.payer.unwrap(),
            comptoken_program: verified_accounts.comptoken_program.unwrap(),
            comptoken_mint: verified_accounts.comptoken_mint.unwrap(),
            global_data_account: verified_accounts.global_data_account.unwrap(),
            unpaid_future_ubi_bank: verified_accounts.unpaid_future_ubi_bank.unwrap(),
            unpaid_future_ubi_bank_data_account: verified_accounts.unpaid_future_ubi_bank_data_account.unwrap(),
            _user_wallet: verified_accounts.user_wallet.unwrap(),
            user_comptoken_token_account: verified_accounts.user_comptoken_token_account.unwrap(),
            user_data_account: verified_accounts.user_data_account.unwrap(),
            transfer_hook_program: verified_accounts.transfer_hook_program.unwrap(),
            extra_account_metas: verified_accounts.extra_account_metas.unwrap(),
            world_id_program: verified_accounts.world_id_program.unwrap(),
            world_id_root: verified_accounts.world_id_root.unwrap(),
            world_id_latest_root: verified_accounts.world_id_latest_root.unwrap(),
            world_id_config: verified_accounts.world_id_config.unwrap(),
            world_id_nullifier: verified_accounts.world_id_nullifier.unwrap(),
            world_id_nullifier_bump: verified_accounts.world_id_nullifier_bump.unwrap(),
        })
    }
}

pub fn verify_human(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  Account Order
    //      [s, w] Payer Account
    //      [] Comptoken Program
    //      [] Comptoken Mint
    //      [w] Comptoken Global Data (also mint authority)
    //      [w] Comptoken Future UBI Bank
    //      [] Comptoken Future UBI Bank Data PDA
    //      [s] User Solana Wallet
    //      [w] User's Comptoken Token Account
    //      [w] User's Data
    //      [] Transfer Hook Program
    //      [] Extra Account Metas Account
    //      [] World ID Program
    //      [] World ID Root
    //      [] World ID Latest Root
    //      [] World ID Config
    //      [w] World ID Nullifier
    //      [] Solana Program
    //      [] Solana Token 2022 Program
    // data:
    //      8 bytes - rent lamports
    //      32 bytes - root hash
    //      32 bytes - nullifier hash
    //      256 bytes - proof

    let VerifyHumanData { rent_lamports, root_hash, nullifier_hash, proof } =
        VerifyHumanData::from_instruction_data(instruction_data)?;

    let VerifyHumanAccounts {
        payer,
        comptoken_program,
        comptoken_mint,
        global_data_account,
        unpaid_future_ubi_bank,
        unpaid_future_ubi_bank_data_account,
        user_comptoken_token_account,
        user_data_account,
        transfer_hook_program,
        extra_account_metas,
        world_id_program,
        world_id_root,
        world_id_latest_root,
        world_id_config,
        world_id_nullifier,
        world_id_nullifier_bump,
        ..
    } = VerifyHumanAccounts::verify_accounts(accounts, program_id, (root_hash, nullifier_hash))?;

    let user_data: &mut UserData = (&user_data_account).into();
    assert!(user_data.is_current(), "user data account is not current");

    // 1. verify unique nullifier hash
    // TODO what to do when people die?

    // this will fail if the nullifier already exists and is not empty
    let is_new_verification = if let Err(e) = create_pda(
        &payer,
        &world_id_nullifier,
        rent_lamports,
        std::mem::size_of::<Nullifier>() as u64,
        program_id,
        &[&[b"Nullifier", nullifier_hash.as_ref(), &[world_id_nullifier_bump]]],
    ) {
        if e != ProgramError::AccountAlreadyInitialized {
            return Err(e);
        }
        let nullifier: &Nullifier = (&world_id_nullifier).into();
        assert_eq!(nullifier.account, Pubkey::default(), "nullifier account already exists but is not empty");

        let global_data: &mut GlobalData = (&global_data_account).into();
        global_data.daily_distribution_data.stale_verified_humans -= 1;

        false
    } else {
        true
    };

    // Set the nullifier data to the user's wallet pubkey
    let nullifier: &mut Nullifier = (&world_id_nullifier).into();
    nullifier.account = *user_data_account.key;

    // 2. cpi to world id program

    verify(
        WorldIdVerifyAccounts {
            user_comptoken_token_account: user_comptoken_token_account.clone(),
            world_id_program,
            world_id_root,
            world_id_latest_root,
            world_id_config,
        },
        &root_hash,
        &nullifier_hash,
        &proof,
    )?;

    // 3. update user data

    msg!("Successfully verified human with World ID, updating user data...");
    user_data.verification_date = normalize_time(get_current_time());
    user_data.nullifier_hash = nullifier_hash;

    let global_data: &mut GlobalData = (&global_data_account).into();
    let verified_humans = global_data.daily_distribution_data.verified_humans;
    if is_new_verification {
        global_data.daily_distribution_data.stale_verified_humans += 1; // this prevents ubi from being allocated for this user in the future, while preventing more than FUTURE_UBI_VERIFIED_HUMANS from getting extra ubi
    }

    let unpaid_future_ubi_bank_raw_data = unpaid_future_ubi_bank.try_borrow_data().unwrap();
    let unpaid_future_ubi_bank_data =
        StateWithExtensions::<Account>::unpack(&unpaid_future_ubi_bank_raw_data).unwrap().base;

    let future_ubi_amount = unpaid_future_ubi_bank_data.amount;

    std::mem::drop(unpaid_future_ubi_bank_raw_data); // drop borrow to allow transfer

    msg!("successfully updated user data");

    if verified_humans < FUTURE_UBI_VERIFIED_HUMANS && is_new_verification {
        msg!("Distributing future UBI to user...");
        let amount = future_ubi_amount / (FUTURE_UBI_VERIFIED_HUMANS - verified_humans);
        transfer(
            &unpaid_future_ubi_bank,
            &user_comptoken_token_account,
            &comptoken_mint,
            &global_data_account,
            &[
                &extra_account_metas,
                &transfer_hook_program,
                &comptoken_program,
                &user_data_account,
                &unpaid_future_ubi_bank,
                &unpaid_future_ubi_bank_data_account,
            ],
            amount,
        )?;
    }

    msg!("Success");
    Ok(())
}

pub(super) struct WorldIdVerifyAccounts<'a> {
    pub(super) user_comptoken_token_account: VerifiedAccountInfo<'a>,
    pub(super) world_id_program: VerifiedAccountInfo<'a>,
    pub(super) world_id_root: VerifiedAccountInfo<'a>,
    pub(super) world_id_latest_root: VerifiedAccountInfo<'a>,
    pub(super) world_id_config: VerifiedAccountInfo<'a>,
}

pub(super) fn verify(
    accounts: WorldIdVerifyAccounts, root_hash: &Hash, nullifier_hash: &Hash, proof: &[u8; WORLD_PROOF_LENGTH],
) -> ProgramResult {
    let external_nullifier_hash = get_external_nullifier_hash(); // TODO: make this a constant
    let signal_bytes = accounts.user_comptoken_token_account.key.to_bytes();
    let signal_hash = hash_to_field(&signal_bytes);

    let mut world_id_cpi_data = Vec::with_capacity(393);
    world_id_cpi_data.extend_from_slice(&[54, 190, 59, 14, 54, 75, 155, 6]); // discriminator https://github.com/wormholelabs-xyz/solana-world-id-onchain-template/blob/main/idls/solana_world_id_program.ts#L801-L808
    world_id_cpi_data.extend_from_slice(root_hash.as_ref());
    world_id_cpi_data.extend_from_slice(&WORLD_VERIFICATION_TYPE);
    world_id_cpi_data.extend_from_slice(&signal_hash);
    world_id_cpi_data.extend_from_slice(nullifier_hash.as_ref());
    world_id_cpi_data.extend_from_slice(&external_nullifier_hash);
    world_id_cpi_data.extend_from_slice(proof);

    let world_id_cpi_instruction = Instruction {
        program_id: SOLANA_WORLD_ID_PROGRAM,
        accounts: vec![
            AccountMeta::new_readonly(*accounts.world_id_root.key, false),
            AccountMeta::new_readonly(*accounts.world_id_latest_root.key, false),
            AccountMeta::new_readonly(*accounts.world_id_config.key, false),
        ],
        data: world_id_cpi_data,
    };

    // If the cpi fails, the program will fail, which will prevent the user from being verified, and not create the nullifier pda
    msg!("Invoking World ID CPI to verify human...");
    invoke_verified(
        &world_id_cpi_instruction,
        &[
            &accounts.world_id_program,
            &accounts.world_id_root,
            &accounts.world_id_latest_root,
            &accounts.world_id_config,
        ],
    )?;

    msg!("World ID CPI invoked successfully, humanness verified.");
    Ok(())
}

// self hosted apps don't have an app registered with the world id program, so they don't have an app id
// instead they use a globally unique action to differentiate between different types of verifications
// the suggested way to do this is to prefix the action with the program/app name
// for verification, the app id is "self_hosted" https://github.com/worldcoin/idkit-js/blob/main/packages/react/src/store/idkit.ts#L15
const APP_ID: &str = "self_hosted";
const ACTION: &str = "COMPTO-verifyHuman";

fn hash_to_field(val: &[u8]) -> [u8; 32] {
    let hash_result = keccak::hash(val).to_bytes();
    let big_int = u256::from_be_bytes(hash_result);
    let shifted: u256 = big_int >> 8;
    shifted.to_be_bytes()
}

fn get_external_nullifier_hash() -> [u8; 32] {
    let app_hash = hash_to_field(APP_ID.as_bytes());
    let mut combined = app_hash.to_vec();
    combined.extend_from_slice(ACTION.as_bytes());
    hash_to_field(&combined)
}
