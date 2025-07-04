use comptoken_utils::{
    get_current_time, normalize_time, user_data::UserData, verify_accounts::VerifiedAccountInfo, SEC_PER_DAY,
};
use solana_program::{account_info::AccountInfo, msg, pubkey::Pubkey};
use spl_token_2022::{extension::StateWithExtensions, state::Account};

use crate::{
    data::global_data::{daily_distribution_data::DailyDistributionData, GlobalData},
    instructions,
    verify_accounts::AccountMetaType,
    ProgramResult,
};

struct FlagStaleAccountData {}
impl FlagStaleAccountData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if !instruction_data.is_empty() {
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }
        // No data expected for this instruction
        Ok(FlagStaleAccountData {})
    }
}

#[rustfmt::skip]
struct FlagStaleAccountAccounts<'a> {
    global_data_account:            VerifiedAccountInfo<'a>,
    user_comptoken_token_account:   VerifiedAccountInfo<'a>,
    user_data_account:              VerifiedAccountInfo<'a>,
}

impl<'a> FlagStaleAccountAccounts<'a> {
    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, _additional_data: (),
    ) -> Result<Self, solana_program::program_error::ProgramError> {
        if accounts.len() < 11 {
            return Err(solana_program::program_error::ProgramError::NotEnoughAccountKeys);
        }

        #[rustfmt::skip]
        let verified_accounts = crate::verify_accounts::verify_accounts(
            accounts,
            program_id,
            crate::verify_accounts::AccountsToVerify {
                global_data_account:            Some(AccountMetaType::Writable),
                user_comptoken_token_account:   Some((false, AccountMetaType::None)),
                user_data_account:              Some((true, AccountMetaType::Writable)),
                ..Default::default()
            },
        )?;

        Ok(FlagStaleAccountAccounts {
            global_data_account: verified_accounts.global_data_account.unwrap(),
            user_comptoken_token_account: verified_accounts.user_comptoken_token_account.unwrap(),
            user_data_account: verified_accounts.user_data_account.unwrap(),
        })
    }
}

pub fn flag_stale_account(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Global Data (also mint authority)
    //      [] user comptoken token account
    //      [w] user data account
    //  data:
    //      None

    let FlagStaleAccountAccounts {
        global_data_account,
        user_comptoken_token_account,
        user_data_account,
    } = FlagStaleAccountAccounts::verify_accounts(accounts, program_id, ())?;

    let _ = FlagStaleAccountData::from_instruction_data(instruction_data)?;

    const STALE_ACCOUNT_THRESHOLD: i64 = SEC_PER_DAY * DailyDistributionData::HISTORY_SIZE as i64;

    let user_wallet_data = user_comptoken_token_account.try_borrow_data().unwrap();
    let user_comptoken_wallet = StateWithExtensions::<Account>::unpack(user_wallet_data.as_ref()).unwrap();
    let original_balance = user_comptoken_wallet.base.amount;

    let (interest, ubi_interest, ubi) = instructions::get_distribution_amounts(
        (&global_data_account).into(),
        <&mut UserData as From<&VerifiedAccountInfo>>::from(&user_data_account).get_days_since_last_payout(),
        original_balance,
    );

    // this is done after calculating distributions to prevent double borrow of user_data_account
    let user_data: &mut UserData = (&user_data_account).into();
    if user_data.last_interest_payout_date > normalize_time(get_current_time()) - STALE_ACCOUNT_THRESHOLD {
        msg!("User account is not stale, no action taken.");
        return Err(solana_program::program_error::ProgramError::InvalidAccountData);
    }
    if user_data.is_stale() {
        msg!("User account is already marked as stale, no action taken.");
        return Err(solana_program::program_error::ProgramError::InvalidAccountData);
    }

    user_data.stale_interest = interest;
    user_data.stale_ubi_interest = ubi_interest;
    user_data.stale_ubi = ubi;

    let global_data: &mut GlobalData = (&global_data_account).into();
    let daily_distribution_data = &mut global_data.daily_distribution_data;

    if user_data.verification_date != 0 {
        // the user was verified
        daily_distribution_data.stale_verified_humans += 1;
    }
    daily_distribution_data.total_stale_comptokens += original_balance + interest + ubi;

    msg!("User account marked as stale. Interest: {}, UBI: {}", interest, ubi);
    Ok(())
}
