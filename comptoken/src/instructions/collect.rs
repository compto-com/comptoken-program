use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey};
use spl_token_2022::{extension::StateWithExtensions, state::Account};

use comptoken_utils::{
    get_current_time, normalize_time,
    user_data::{UserData, UserDataVerificationState},
    verify_accounts::VerifiedAccountInfo,
};

use crate::{
    data::global_data::GlobalData,
    instructions::{InstructionAccounts, InstructionData},
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

#[rustfmt::skip]
struct CollectAccounts<'a> {
    comptoken_program:                           VerifiedAccountInfo<'a>,
    comptoken_mint:                              VerifiedAccountInfo<'a>,
    global_data_account:                         VerifiedAccountInfo<'a>,
    unpaid_interest_bank:                        VerifiedAccountInfo<'a>,
    unpaid_verified_human_ubi_bank:              VerifiedAccountInfo<'a>,
    unpaid_interest_bank_data_account:           VerifiedAccountInfo<'a>,
    unpaid_verified_human_ubi_bank_data_account: VerifiedAccountInfo<'a>,
    _user_wallet:                                VerifiedAccountInfo<'a>,
    user_comptoken_token_account:                VerifiedAccountInfo<'a>,
    user_data_account:                           VerifiedAccountInfo<'a>,
    transfer_hook_program:                       VerifiedAccountInfo<'a>,
    extra_account_metas:                         VerifiedAccountInfo<'a>,
    _solana_token_2022_program:                  VerifiedAccountInfo<'a>,
}

impl<'a> InstructionAccounts<'a> for CollectAccounts<'a> {
    type AdditionalVerificationData = ();

    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, _additional_data: Self::AdditionalVerificationData,
    ) -> Result<Self, solana_program::program_error::ProgramError> {
        #[rustfmt::skip]
        let verified_accounts = verify_accounts(
            accounts,
            program_id,
            AccountsToVerify {
                comptoken_program:                           Some(AccountMetaType::None),
                comptoken_mint:                              Some(AccountMetaType::None),
                global_data_account:                         Some(AccountMetaType::Writable),
                unpaid_interest_bank:                        Some(AccountMetaType::Writable),
                unpaid_verified_human_ubi_bank:              Some(AccountMetaType::Writable),
                unpaid_interest_bank_data_account:           Some(AccountMetaType::None),
                unpaid_verified_human_ubi_bank_data_account: Some(AccountMetaType::None),
                user_wallet:                                 Some(AccountMetaType::Signer),
                user_comptoken_token_account:                Some((true, AccountMetaType::Writable)),
                user_data_account:                           Some((true, AccountMetaType::Writable)),
                transfer_hook_program:                       Some(AccountMetaType::None),
                extra_account_metas:                         Some(AccountMetaType::None),
                solana_token_2022_program:                   Some(AccountMetaType::None),
                ..Default::default()
            },
        )?;

        Ok(CollectAccounts {
            comptoken_program: verified_accounts.comptoken_program.unwrap(),
            comptoken_mint: verified_accounts.comptoken_mint.unwrap(),
            global_data_account: verified_accounts.global_data_account.unwrap(),
            unpaid_interest_bank: verified_accounts.unpaid_interest_bank.unwrap(),
            unpaid_verified_human_ubi_bank: verified_accounts.unpaid_verified_human_ubi_bank.unwrap(),
            unpaid_interest_bank_data_account: verified_accounts.unpaid_interest_bank_data_account.unwrap(),
            unpaid_verified_human_ubi_bank_data_account: verified_accounts
                .unpaid_verified_human_ubi_bank_data_account
                .unwrap(),
            _user_wallet: verified_accounts.user_wallet.unwrap(),
            user_comptoken_token_account: verified_accounts.user_comptoken_token_account.unwrap(),
            user_data_account: verified_accounts.user_data_account.unwrap(),
            transfer_hook_program: verified_accounts.transfer_hook_program.unwrap(),
            extra_account_metas: verified_accounts.extra_account_metas.unwrap(),
            _solana_token_2022_program: verified_accounts.solana_token_2022_program.unwrap(),
        })
    }
}

pub fn collect(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [] Comptoken Program
    //      [] Comptoken Mint
    //      [w] Comptoken Global Data (also mint authority)
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

    let CollectAccounts {
        comptoken_program,
        comptoken_mint,
        global_data_account,
        unpaid_interest_bank,
        unpaid_verified_human_ubi_bank,
        unpaid_interest_bank_data_account,
        unpaid_verified_human_ubi_bank_data_account,
        user_comptoken_token_account,
        user_data_account,
        transfer_hook_program,
        extra_account_metas,
        ..
    } = CollectAccounts::verify_accounts(accounts, program_id, ())?;

    let _ = CollectData::from_instruction_data(instruction_data)?;

    // borrow of user_comptoken_token_account must be scoped to avoid reborrowing issues TODO: is this needed?
    let original_balance = {
        let user_wallet_data = user_comptoken_token_account.try_borrow_data().unwrap();
        let user_comptoken_wallet = StateWithExtensions::<Account>::unpack(user_wallet_data.as_ref()).unwrap();
        user_comptoken_wallet.base.amount
    };

    let (interest, ubi_interest, ubi) =
        get_inactive_or_distribution_amounts(&global_data_account, &user_data_account, original_balance);

    // borrow of user_data must be scoped to avoid reborrowing issues
    let verification_state = {
        let user_data: &mut UserData = (&user_data_account).into();
        user_data.last_interest_payout_date = normalize_time(get_current_time());
        user_data.verification_state()
    };

    let payout_interest = if verification_state == UserDataVerificationState::Verified {
        // if the user is verified, we can use the full interest
        interest + ubi_interest
    } else {
        // if the user is not verified, we only use the interest part
        interest
    };

    if payout_interest > 0 {
        transfer(
            &unpaid_interest_bank,
            &user_comptoken_token_account,
            &comptoken_mint,
            &global_data_account,
            &[
                &extra_account_metas,
                &transfer_hook_program,
                &comptoken_program,
                &user_data_account,
                &unpaid_interest_bank_data_account,
            ],
            payout_interest,
        )?;
    }
    msg!("interest transferred");

    // get ubi if verified
    if ubi + ubi_interest > 0 {
        use UserDataVerificationState::*;
        match verification_state {
            Verified => {
                msg!("verified human");
                transfer(
                    &unpaid_verified_human_ubi_bank,
                    &user_comptoken_token_account,
                    &comptoken_mint,
                    &global_data_account,
                    &[
                        &extra_account_metas,
                        &transfer_hook_program,
                        &comptoken_program,
                        &user_data_account,
                        &unpaid_verified_human_ubi_bank_data_account,
                    ],
                    ubi + ubi_interest,
                )?;
                msg!("ubi transferred");
            }
            Stale => {
                burn(
                    ubi_interest,
                    ubi,
                    BurnAccounts {
                        global_data_account: &global_data_account,
                        comptoken_mint: &comptoken_mint,
                        unpaid_interest_bank: &unpaid_interest_bank,
                        unpaid_verified_human_ubi_bank: &unpaid_verified_human_ubi_bank,
                        unpaid_interest_bank_data_account: &unpaid_interest_bank_data_account,
                        unpaid_verified_human_ubi_bank_data_account: &unpaid_verified_human_ubi_bank_data_account,
                        transfer_hook_program: &transfer_hook_program,
                        extra_account_metas: &extra_account_metas,
                        comptoken_program: &comptoken_program,
                    },
                )?;
                msg!("ubi burned");
            }
            Unverified => msg!("Unverified users should not receive UBI"), // should never happen, but have to handle it
        }
    }

    Ok(())
}

/// Returns (interest, ubi_interest, ubi).
///
/// If the user is inactive, uses the precomputed `inactive_<name>` values,
/// resets them to zero, and returns early to avoid calculating incorrect distributions.
fn get_inactive_or_distribution_amounts(
    global_data_account: &VerifiedAccountInfo, user_data_account: &VerifiedAccountInfo, original_balance: u64,
) -> (u64, u64, u64) {
    let user_data: &mut UserData = user_data_account.into();

    let (interest, ubi_interest, ubi) = if user_data.is_flagged_inactive() {
        get_inactive_distribution_amounts(global_data_account.into(), user_data, original_balance)
    } else {
        let distribution_amounts = get_distribution_amounts(
            global_data_account.into(),
            user_data.get_days_since_last_payout(),
            original_balance,
        );
        if user_data.verification_state() == UserDataVerificationState::Verified {
            // if the user is verified, we can use the full distribution amounts
            distribution_amounts
        } else {
            // if the user is not verified, we only use the interest part
            (distribution_amounts.0, 0, 0)
        }
    };

    (interest, ubi_interest, ubi)
}

pub(super) fn get_distribution_amounts(
    global_data: &GlobalData, days_since_last_update: usize, original_balance: u64,
) -> (u64, u64, u64) {
    msg!("verified human");
    global_data
        .daily_distribution_data
        .get_distributions_for_n_days(days_since_last_update, original_balance)
}

fn get_inactive_distribution_amounts(
    global_data: &mut GlobalData, user_data: &mut UserData, original_balance: u64,
) -> (u64, u64, u64) {
    let mut distribution_amounts =
        (user_data.inactive_interest, user_data.inactive_ubi_interest, user_data.inactive_ubi);
    user_data.inactive_interest = 0;
    user_data.inactive_ubi_interest = 0;
    user_data.inactive_ubi = 0;

    let daily_distribution_data = &mut global_data.daily_distribution_data;

    use UserDataVerificationState::*;
    match user_data.verification_state() {
        Verified => {
            msg!("verified human");
            // the user was verified
            daily_distribution_data.inactive_verified_humans -= 1;
            daily_distribution_data.total_inactive_comptokens -=
                original_balance + distribution_amounts.0 + distribution_amounts.1 + distribution_amounts.2;
        }
        Stale => {
            msg!("stale verified human");
            daily_distribution_data.inactive_verified_humans -= 1;
            // the user was verified, but is now stale, the ubi and ubi_interest are not paid out
            // the ubi and ubi_interest are burned, so they need to be subtracted from the total inactive comptokens
            daily_distribution_data.total_inactive_comptokens -=
                original_balance + distribution_amounts.0 + distribution_amounts.1 + distribution_amounts.2;
        }
        Unverified => {
            // ubi should already be 0 for unverified users, but just in case
            msg!("stale unverified human");
            distribution_amounts.1 = 0;
            distribution_amounts.2 = 0;
        }
    }

    distribution_amounts
}

#[rustfmt::skip]
struct BurnAccounts<'a, 'b> {
    global_data_account:                         &'a VerifiedAccountInfo<'b>,
    comptoken_mint:                              &'a VerifiedAccountInfo<'b>,
    unpaid_interest_bank:                        &'a VerifiedAccountInfo<'b>,
    unpaid_verified_human_ubi_bank:              &'a VerifiedAccountInfo<'b>,
    unpaid_interest_bank_data_account:           &'a VerifiedAccountInfo<'b>,
    unpaid_verified_human_ubi_bank_data_account: &'a VerifiedAccountInfo<'b>,
    transfer_hook_program:                       &'a VerifiedAccountInfo<'b>,
    extra_account_metas:                         &'a VerifiedAccountInfo<'b>,
    comptoken_program:                           &'a VerifiedAccountInfo<'b>,
}

fn burn(ubi_interest: u64, ubi: u64, accounts: BurnAccounts) -> ProgramResult {
    msg!("burning UBI: {} + {} interest = {}", ubi, ubi_interest, ubi + ubi_interest);
    // actually burning the tokens (using spl_token_2022::instruction::burn) reduces the comptoken supply,
    // which will interfere with the daily distribution calculations,
    // so we instead include the burned comptokens in the next daily distribution as ubi
    // this way, the comptoken supply remains unchanged, and the people who collect UBI will receive the
    // burned comptokens (which they should have received in the first place, but it was distributed to stale accounts
    // in case they reverified themselves)

    let global_data: &mut GlobalData = accounts.global_data_account.into();
    global_data.daily_distribution_data.burned_comptokens += ubi + ubi_interest;

    transfer(
        accounts.unpaid_interest_bank,
        accounts.unpaid_verified_human_ubi_bank,
        accounts.comptoken_mint,
        accounts.global_data_account,
        &[
            accounts.extra_account_metas,
            accounts.transfer_hook_program,
            accounts.comptoken_program,
            accounts.unpaid_interest_bank_data_account,
            accounts.unpaid_verified_human_ubi_bank_data_account,
        ],
        ubi_interest,
    )
}
