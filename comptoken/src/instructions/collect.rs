use solana_program::{
    account_info::AccountInfo, clock::SECONDS_PER_DAY, entrypoint::ProgramResult, msg, pubkey::Pubkey,
};
use spl_token_2022::{extension::StateWithExtensions, state::Account};

use comptoken_utils::{get_current_time, normalize_time, user_data::UserData};

use crate::{
    global_data::GlobalData,
    instructions::InstructionData,
    transfer,
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

struct CollectData {}

impl InstructionData for CollectData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if !instruction_data.is_empty() {
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }
        // No data expected for this instruction
        Ok(CollectData {})
    }
}

pub fn collect(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [] Comptoken Program
    //      [] Comptoken Mint
    //      [] Comptoken Global Data (also mint authority)
    //      [w] Comptoken Interest Bank
    //      [w] Comptoken Verified Human UBI Bank
    //      [] Interest Bank Data PDA (doesn't actually exist)
    //      [] Verified Human UBI Bank Data PDA (doesn't actually exist)
    //      [s] User Solana Wallet
    //      [w] User's Comptoken Token Account
    //      [w] User's Data
    //      [] Transfer Hook Program
    //      [] Extra Account Metas Account
    //      [] Solana Token 2022 Program
    //  data:
    //      None

    #[rustfmt::skip]
    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            comptoken_program:            Some(AccountMetaType::None),
            comptoken_mint:               Some(AccountMetaType::None),
            global_data:                  Some(AccountMetaType::None),
            interest_bank:                Some(AccountMetaType::Writable),
            verified_human_ubi_bank:      Some(AccountMetaType::Writable),
            interest_bank_data:           Some(AccountMetaType::None),
            verified_human_ubi_bank_data: Some(AccountMetaType::None),
            user_wallet:                  Some(AccountMetaType::Signer),
            user_comptoken_token_account: Some(AccountMetaType::Writable),
            user_data:                    Some((true, AccountMetaType::Writable)),
            transfer_hook_program:        Some(AccountMetaType::None),
            extra_account_metas:          Some(AccountMetaType::None),
            solana_token_2022_program:    Some(AccountMetaType::None),
            ..Default::default()
        },
    )?;

    let comptoken_program = verified_accounts.comptoken_program.unwrap();
    let comptoken_mint_account = verified_accounts.comptoken_mint.unwrap();
    let global_data_account = verified_accounts.global_data.unwrap();
    let unpaid_interest_bank = verified_accounts.interest_bank.unwrap();
    let unpaid_interest_bank_data_pda = verified_accounts.interest_bank_data.unwrap();
    let unpaid_verified_human_ubi_bank = verified_accounts.verified_human_ubi_bank.unwrap();
    let unpaid_verified_human_ubi_bank_data_pda = verified_accounts.verified_human_ubi_bank_data.unwrap();
    let user_comptoken_token_account = verified_accounts.user_comptoken_token_account.unwrap();
    let user_data_account = verified_accounts.user_data.unwrap();
    let transfer_hook_program = verified_accounts.transfer_hook_program.unwrap();
    let extra_account_metas_account = verified_accounts.extra_account_metas.unwrap();

    let _ = CollectData::from_instruction_data(instruction_data)?;

    let interest;
    let is_verified_human;
    let ubi;
    {
        let user_wallet_data = user_comptoken_token_account.try_borrow_data().unwrap();
        let user_comptoken_wallet = StateWithExtensions::<Account>::unpack(user_wallet_data.as_ref()).unwrap();
        let global_data: &mut GlobalData = (&global_data_account).into();
        let user_data: &mut UserData = (&user_data_account).into();
        is_verified_human = user_data.is_verified();

        // get days since last update
        let current_day = normalize_time(get_current_time());
        let days_since_last_update = (current_day - user_data.last_interest_payout_date) / (SECONDS_PER_DAY as i64);

        msg!("total before interest: {}", user_comptoken_wallet.base.amount);
        // get interest and ubi
        if is_verified_human {
            msg!("verified human");
            (interest, ubi) = global_data
                .daily_distribution_data
                .get_distributions_for_n_days(days_since_last_update as usize, user_comptoken_wallet.base.amount);
        } else {
            msg!("not verified human");
            interest = global_data
                .daily_distribution_data
                .get_interest_for_n_days(days_since_last_update as usize, user_comptoken_wallet.base.amount);
            ubi = 0;
        }

        msg!("Interest: {}", interest);
        msg!("ubi: {}", ubi);
        user_data.last_interest_payout_date = current_day;
    }
    if interest > 0 {
        transfer(
            &unpaid_interest_bank,
            &user_comptoken_token_account,
            &comptoken_mint_account,
            &global_data_account,
            &[
                &extra_account_metas_account,
                &transfer_hook_program,
                &comptoken_program,
                &user_data_account,
                &unpaid_interest_bank_data_pda,
            ],
            interest,
        )?;
    }
    msg!("interest transferred");

    // get ubi if verified
    if is_verified_human && ubi > 0 {
        transfer(
            &unpaid_verified_human_ubi_bank,
            &user_comptoken_token_account,
            &comptoken_mint_account,
            &global_data_account,
            &[
                &extra_account_metas_account,
                &transfer_hook_program,
                &comptoken_program,
                &user_data_account,
                &unpaid_verified_human_ubi_bank_data_pda,
            ],
            ubi,
        )?;
        msg!("ubi transferred");
    } else {
        msg!("user not verified human, skipping ubi transfer");
    }

    Ok(())
}
