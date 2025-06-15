use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey};

use comptoken_utils::{user_data::UserData, verify_accounts::VerifiedAccountInfo};

use crate::{
    comptoken_proof::ComptokenProof,
    constants::MINING_AMOUNT,
    get_next_data,
    global_data::{valid_blockhashes::ValidBlockhashes, GlobalData},
    mint,
    verify_accounts::{verify_accounts, AccountsToVerify},
};

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

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            comptoken_mint: Some((false, true)),
            global_data: Some((false, false)),
            user_wallet: Some((true, false)),
            user_comptoken_token_account: Some((false, true)),
            user_data: Some((true, (false, true))),
            solana_token_2022_program: Some((false, false)),
            ..Default::default()
        },
    )?;
    let comptoken_mint_account = verified_accounts.comptoken_mint.unwrap();
    let global_data_account = verified_accounts.global_data.unwrap();
    let user_comptoken_token_account = verified_accounts.user_comptoken_token_account.unwrap();
    let user_data_account = verified_accounts.user_data.unwrap();

    let (submitted_proof, instruction_data) =
        get_next_data(instruction_data, ComptokenProof::SUBMITTED_DATA_SIZE, |b| b.try_into().expect("correct size"));
    assert!(instruction_data.is_empty(), "incorrect instruction data");

    let global_data: &mut GlobalData = (&global_data_account).into();

    let proof = ComptokenProof::verify_submitted_proof(
        &user_comptoken_token_account,
        submitted_proof,
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
        &[&comptoken_mint_account, &user_comptoken_token_account, &global_data_account],
    )?;

    Ok(())
}

fn store_hash(proof: ComptokenProof, data_account: &VerifiedAccountInfo, validhash: &ValidBlockhashes) {
    let user_data: &mut UserData = data_account.into();
    user_data.insert(&proof.hash, &validhash.valid_blockhash);
}
