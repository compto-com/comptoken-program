use solana_program::{
    account_info::AccountInfo, clock::SECONDS_PER_DAY, entrypoint::ProgramResult, msg, pubkey::Pubkey,
};
use spl_token_2022::{
    extension::StateWithExtensions,
    state::{Account, Mint},
};

use comptoken_utils::get_current_time;

use crate::{
    global_data::{daily_distribution_data::DailyDistributionValues, GlobalData},
    mint,
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

pub fn daily_distribution(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [] Comptoken Mint
    //      [w] Comptoken Global Data (also mint authority)
    //      [w] Comptoken Interest Bank
    //      [w] Comptoken Verified Human UBI Bank
    //      [w] Comptoken Future UBI Bank
    //      [] Solana Token 2022 Program
    //      [] Solana SlotHashes Sysvar
    //      [w] Comptoken Future UBI Bank
    //  data:
    //      None

    #[rustfmt::skip]
    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            comptoken_mint:            Some(AccountMetaType::None),
            global_data:               Some(AccountMetaType::Writable),
            interest_bank:             Some(AccountMetaType::Writable),
            verified_human_ubi_bank:   Some(AccountMetaType::Writable),
            future_ubi_bank:           Some(AccountMetaType::Writable),
            solana_token_2022_program: Some(AccountMetaType::None),
            slothashes:                Some(AccountMetaType::None),
            ..Default::default()
        },
    )?;

    let comptoken_mint_account = verified_accounts.comptoken_mint.unwrap();
    let global_data_account = verified_accounts.global_data.unwrap();
    let unpaid_interest_bank_account = verified_accounts.interest_bank.unwrap();
    let unpaid_verified_human_ubi_bank_account = verified_accounts.verified_human_ubi_bank.unwrap();
    let unpaid_future_ubi_bank_account = verified_accounts.future_ubi_bank.unwrap();
    let slothashes_account = verified_accounts.slothashes.unwrap();

    assert!(instruction_data.is_empty(), "incorrect instruction data");

    let daily_distribution: DailyDistributionValues;
    // scope to prevent reborrowing issues
    {
        let mut global_data_account_data = global_data_account.try_borrow_mut_data().unwrap();
        let global_data: &mut GlobalData = global_data_account_data.as_mut().into();
        let mint_data = comptoken_mint_account.try_borrow_data().unwrap();
        let comptoken_mint = StateWithExtensions::<Mint>::unpack(&mint_data).unwrap().base;
        let unpaid_future_ubi_bank_data = unpaid_future_ubi_bank_account.try_borrow_data().unwrap();
        let unpaid_future_ubi_bank = StateWithExtensions::<Account>::unpack(&unpaid_future_ubi_bank_data).unwrap().base;

        let current_time = get_current_time();
        assert!(
            current_time > global_data.daily_distribution_data.last_daily_distribution_time + SECONDS_PER_DAY as i64,
            "daily distribution already called today"
        );

        daily_distribution =
            global_data.daily_distribution_event(&comptoken_mint, &unpaid_future_ubi_bank, &slothashes_account);
    }
    // mint to banks
    msg!("Interest Distribution: {}", daily_distribution.interest_distribution);
    mint(
        &global_data_account,
        &unpaid_interest_bank_account,
        daily_distribution.interest_distribution,
        &[&comptoken_mint_account, &global_data_account, &unpaid_interest_bank_account],
    )?;
    msg!("Ubi for verified humans: {}", daily_distribution.ubi_for_verified_humans);
    mint(
        &global_data_account,
        &unpaid_verified_human_ubi_bank_account,
        daily_distribution.ubi_for_verified_humans,
        &[&comptoken_mint_account, &global_data_account, &unpaid_verified_human_ubi_bank_account],
    )?;
    msg!("Future UBI Distribution: {}", daily_distribution.future_ubi_distribution);
    mint(
        &global_data_account,
        &unpaid_future_ubi_bank_account,
        daily_distribution.future_ubi_distribution,
        &[&comptoken_mint_account, &global_data_account, &unpaid_future_ubi_bank_account],
    )
}
