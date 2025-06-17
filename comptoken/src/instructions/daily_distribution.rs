use solana_program::{
    account_info::AccountInfo, clock::SECONDS_PER_DAY, entrypoint::ProgramResult, msg, pubkey::Pubkey,
};
use spl_token_2022::{
    extension::StateWithExtensions,
    state::{Account, Mint},
};

use comptoken_utils::{get_current_time, verify_accounts::VerifiedAccountInfo};

use crate::{
    global_data::{daily_distribution_data::DailyDistributionValues, GlobalData},
    instructions::{InstructionAccounts, InstructionData},
    mint,
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

struct DailyDistributionData {}

impl InstructionData for DailyDistributionData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if !instruction_data.is_empty() {
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }
        // No data expected for this instruction
        Ok(DailyDistributionData {})
    }
}

#[rustfmt::skip]
struct DailyDistributionAccounts<'a> {
    comptoken_mint:                 VerifiedAccountInfo<'a>,
    global_data_account:            VerifiedAccountInfo<'a>,
    unpaid_interest_bank:           VerifiedAccountInfo<'a>,
    unpaid_verified_human_ubi_bank: VerifiedAccountInfo<'a>,
    unpaid_future_ubi_bank:         VerifiedAccountInfo<'a>,
    _solana_token_2022_program:     VerifiedAccountInfo<'a>,
    slothashes:                     VerifiedAccountInfo<'a>,
}

impl<'a> InstructionAccounts<'a> for DailyDistributionAccounts<'a> {
    type AdditionalVerificationData = ();

    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, _additional_data: Self::AdditionalVerificationData,
    ) -> Result<Self, solana_program::program_error::ProgramError> {
        #[rustfmt::skip]
        let verified_accounts = verify_accounts(
            accounts,
            program_id,
            AccountsToVerify {
                comptoken_mint:                 Some(AccountMetaType::None),
                global_data_account:            Some(AccountMetaType::Writable),
                unpaid_interest_bank:           Some(AccountMetaType::Writable),
                unpaid_verified_human_ubi_bank: Some(AccountMetaType::Writable),
                unpaid_future_ubi_bank:         Some(AccountMetaType::Writable),
                solana_token_2022_program:      Some(AccountMetaType::None),
                slothashes:                     Some(AccountMetaType::None),
                ..Default::default()
            },
        )?;

        Ok(DailyDistributionAccounts {
            comptoken_mint: verified_accounts.comptoken_mint.unwrap(),
            global_data_account: verified_accounts.global_data_account.unwrap(),
            unpaid_interest_bank: verified_accounts.unpaid_interest_bank.unwrap(),
            unpaid_verified_human_ubi_bank: verified_accounts.unpaid_verified_human_ubi_bank.unwrap(),
            unpaid_future_ubi_bank: verified_accounts.unpaid_future_ubi_bank.unwrap(),
            _solana_token_2022_program: verified_accounts.solana_token_2022_program.unwrap(),
            slothashes: verified_accounts.slothashes.unwrap(),
        })
    }
}

pub fn daily_distribution(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [] Comptoken Mint
    //      [w] Comptoken Global Data (also mint authority)
    //      [w] Comptoken Interest Bank
    //      [w] Comptoken Verified Human UBI Bank
    //      [w] Comptoken Future UBI Bank
    //      [] Solana Token 2022 Program
    //      [] Solana SlotHashes Sysvar
    //  data:
    //      None

    let DailyDistributionAccounts {
        comptoken_mint,
        global_data_account,
        unpaid_interest_bank,
        unpaid_verified_human_ubi_bank,
        unpaid_future_ubi_bank,
        slothashes: slothashes_account,
        ..
    } = DailyDistributionAccounts::verify_accounts(accounts, program_id, ())?;

    let _ = DailyDistributionData::from_instruction_data(instruction_data)?;

    let daily_distribution: DailyDistributionValues;
    // scope to prevent reborrowing issues
    {
        let mut global_data_account_data = global_data_account.try_borrow_mut_data().unwrap();
        let global_data: &mut GlobalData = global_data_account_data.as_mut().into();
        let mint_data = comptoken_mint.try_borrow_data().unwrap();
        let comptoken_mint = StateWithExtensions::<Mint>::unpack(&mint_data).unwrap().base;
        let unpaid_future_ubi_bank_data = unpaid_future_ubi_bank.try_borrow_data().unwrap();
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
        &unpaid_interest_bank,
        daily_distribution.interest_distribution,
        &[&comptoken_mint, &global_data_account, &unpaid_interest_bank],
    )?;
    msg!("Ubi for verified humans: {}", daily_distribution.ubi_for_verified_humans);
    mint(
        &global_data_account,
        &unpaid_verified_human_ubi_bank,
        daily_distribution.ubi_for_verified_humans,
        &[&comptoken_mint, &global_data_account, &unpaid_verified_human_ubi_bank],
    )?;
    msg!("Future UBI Distribution: {}", daily_distribution.future_ubi_distribution);
    mint(
        &global_data_account,
        &unpaid_future_ubi_bank,
        daily_distribution.future_ubi_distribution,
        &[&comptoken_mint, &global_data_account, &unpaid_future_ubi_bank],
    )
}
