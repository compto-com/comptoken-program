pub mod user_data;
pub mod verify_accounts;

use spl_token_2022::solana_program::{
    clock::Clock, entrypoint::ProgramResult, instruction::Instruction, program::invoke_signed, pubkey::Pubkey,
    system_instruction, sysvar::Sysvar,
};

use verify_accounts::VerifiedAccountInfo;

pub const SEC_PER_DAY: i64 = 86_400;

pub fn create_pda<'a>(
    payer: &VerifiedAccountInfo<'a>, new_account: &VerifiedAccountInfo<'a>, lamports: u64, space: u64, owner: &Pubkey,
    signers_seeds: &[&[&[u8]]],
) -> ProgramResult {
    let create_acct_instr = system_instruction::create_account(payer.key, new_account.key, lamports, space, owner);
    // The PDA that is being created must sign for its own creation.
    invoke_signed_verified(&create_acct_instr, &[payer, new_account], signers_seeds)
}

pub fn invoke_signed_verified(
    instruction: &Instruction, accounts: &[&VerifiedAccountInfo], signers_seeds: &[&[&[u8]]],
) -> ProgramResult {
    // Convert VerifiedAccountInfo references to AccountInfo references
    let account_refs: Vec<_> = accounts.iter().map(|acct| acct.0.clone()).collect();
    invoke_signed(instruction, &account_refs, signers_seeds)
}

pub fn get_current_time() -> i64 {
    Clock::get().unwrap().unix_timestamp
}

pub fn normalize_time(time: i64) -> i64 {
    time - time % SEC_PER_DAY // midnight UTC+0
}
