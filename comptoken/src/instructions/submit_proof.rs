use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey};

use comptoken_utils::{user_data::UserData, verify_accounts::VerifiedAccountInfo};

use crate::{
    comptoken_proof::ComptokenProof,
    constants::MINING_AMOUNT,
    global_data::{valid_blockhashes::ValidBlockhashes, GlobalData},
    instructions::{InstructionAccounts, InstructionData},
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
    {get_next_data, mint},
};

struct SubmitProofData {
    submitted_proof: [u8; ComptokenProof::SUBMITTED_DATA_SIZE],
}

impl InstructionData for SubmitProofData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if instruction_data.len() != ComptokenProof::SUBMITTED_DATA_SIZE {
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }
        let (submitted_proof, instruction_data) =
            get_next_data(instruction_data, ComptokenProof::SUBMITTED_DATA_SIZE, |b| {
                b.try_into().expect("correct size")
            });
        assert!(instruction_data.is_empty(), "incorrect instruction data");

        Ok(SubmitProofData { submitted_proof })
    }
}

#[rustfmt::skip]
struct SubmitProofAccounts<'a> {
    comptoken_mint:               VerifiedAccountInfo<'a>,
    global_data_account:          VerifiedAccountInfo<'a>,
    _user_wallet:                 VerifiedAccountInfo<'a>,
    user_comptoken_token_account: VerifiedAccountInfo<'a>,
    user_data_account:            VerifiedAccountInfo<'a>,
    _solana_token_2022_program:   VerifiedAccountInfo<'a>,
}

impl<'a> InstructionAccounts<'a> for SubmitProofAccounts<'a> {
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
                user_comptoken_token_account: Some((true, AccountMetaType::Writable)),
                user_data_account:            Some((true, AccountMetaType::Writable)),
                solana_token_2022_program:    Some(AccountMetaType::None),
                ..Default::default()
            },
        )?;

        Ok(SubmitProofAccounts {
            comptoken_mint: verified_accounts.comptoken_mint.unwrap(),
            global_data_account: verified_accounts.global_data_account.unwrap(),
            _user_wallet: verified_accounts.user_wallet.unwrap(),
            user_comptoken_token_account: verified_accounts.user_comptoken_token_account.unwrap(),
            user_data_account: verified_accounts.user_data_account.unwrap(),
            _solana_token_2022_program: verified_accounts.solana_token_2022_program.unwrap(),
        })
    }
}

pub fn submit_proof(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Mint Account
    //      [] Comptoken Global Data Account (also Mint Authority)
    //      [s] User's Wallet
    //      [w] User's Comptoken Token Account
    //      [w] User's Data Account
    //      [] Solana Token 2022 Program
    //  data:
    //      72 bytes - submitted proof
    //          32 bytes - recent block hash
    //          8 bytes - lamports
    //          32 bytes - nonce

    let SubmitProofAccounts {
        comptoken_mint,
        global_data_account,
        user_comptoken_token_account,
        user_data_account,
        ..
    } = SubmitProofAccounts::verify_accounts(accounts, program_id, ())?;

    let SubmitProofData { submitted_proof } = SubmitProofData::from_instruction_data(instruction_data)?;

    // scoping to prevent reborrowing issues TODO: is this needed?
    {
        let user_data: &UserData = (&user_data_account).into();
        if !user_data.is_current() {
            return Err(solana_program::program_error::ProgramError::InvalidAccountData);
        }
    }

    let global_data: &mut GlobalData = (&global_data_account).into();

    let proof = ComptokenProof::verify_submitted_proof(
        &user_comptoken_token_account,
        &submitted_proof,
        &global_data.valid_blockhashes,
    );

    msg!("data/accounts verified");

    // now save the hash to the account, returning an error if the hash already exists
    store_hash(proof, &user_data_account, &global_data.valid_blockhashes);
    msg!("stored the proof");
    mint(
        &global_data_account,
        &user_comptoken_token_account,
        MINING_AMOUNT,
        &[&comptoken_mint, &user_comptoken_token_account, &global_data_account],
    )?;

    Ok(())
}

fn store_hash(proof: ComptokenProof, data_account: &VerifiedAccountInfo, validhash: &ValidBlockhashes) {
    let user_data: &mut UserData = data_account.into();
    user_data.insert(&proof.hash, &validhash.valid_blockhash);
}
