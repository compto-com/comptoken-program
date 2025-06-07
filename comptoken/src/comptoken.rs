mod comptoken_proof;
mod constants;
mod global_data;
mod verify_accounts;

use ethnum::u256;
use spl_token_2022::{
    extension::StateWithExtensions,
    instruction::mint_to,
    onchain,
    state::{Account, Mint},
};

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::MAX_PERMITTED_DATA_INCREASE,
    hash::{Hash, HASH_BYTES},
    instruction::{AccountMeta, Instruction},
    keccak, msg,
    program::set_return_data,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use comptoken_utils::{
    create_pda, get_current_time, invoke_signed_verified, invoke_verified, normalize_time,
    user_data::{UserData, USER_DATA_MIN_SIZE},
    SEC_PER_DAY,
};

use comptoken_proof::ComptokenProof;
use constants::*;
use global_data::{daily_distribution_data::DailyDistributionValues, valid_blockhashes::ValidBlockhashes, GlobalData};
use verify_accounts::*;

// declare and export the program's entrypoint
entrypoint!(process_instruction);

type ProgramResult = Result<(), ProgramError>;

const GLOBAL_DATA_ACCOUNT_SPACE: u64 = std::mem::size_of::<GlobalData>() as u64;

mod generated;
use generated::{
    COMPTOKEN_MINT_ADDRESS, COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS,
    COMPTO_INTEREST_BANK_ACCOUNT_SEEDS, COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS, TRANSFER_HOOK_ID,
};

// program entrypoint's implementation
pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    msg!("instruction_data: {:?}", instruction_data);
    match instruction_data[0] {
        1 => {
            msg!("Mint New Comptokens");
            mint_comptokens(program_id, accounts, &instruction_data[1..])
        }
        2 => {
            msg!("Initialize Comptoken Program");
            initialize_comptoken_program(program_id, accounts, &instruction_data[1..])
        }
        3 => {
            msg!("Create User Data Account");
            create_user_data_account(program_id, accounts, &instruction_data[1..])
        }
        4 => {
            msg!("Perform Daily Distribution Event");
            daily_distribution_event(program_id, accounts, &instruction_data[1..])
        }
        5 => {
            msg!("Get Valid Blockhashes");
            get_valid_blockhashes(program_id, accounts, &instruction_data[1..])
        }
        6 => {
            msg!("Get Owed Comptokens");
            get_owed_comptokens(program_id, accounts, &instruction_data[1..])
        }
        7 => {
            msg!("Grow User Data Acccount");
            realloc_user_data(program_id, accounts, &instruction_data[1..])
        }
        8 => {
            msg!("Verify Human");
            verify_human(program_id, accounts, &instruction_data[1..])
        }
        255 => {
            msg!("Test Mint");
            test_mint(program_id, accounts, &instruction_data[1..])
        }
        _ => {
            msg!("Invalid Instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

#[cfg(feature = "testmode")]
pub fn test_mint(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Mint Account
    //      [] Comptoken Global Data Account (also Mint Authority)
    //      [s] User Wallet
    //      [] User Comptoken Token Account
    //      [] Solana Token 2022
    //  data:
    //      8 bytes - amount

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            comptoken_mint: Some((false, true)),
            global_data: Some((false, false)),
            user_wallet: Some((true, false)),
            user_comptoken_token_account: Some((false, false)),
            solana_token_2022_program: Some((false, false)),
            ..Default::default()
        },
    )?;

    let comptoken_mint_account = verified_accounts.comptoken_mint.unwrap();
    let global_data_account = verified_accounts.global_data.unwrap();
    let user_comptoken_token_account = verified_accounts.user_comptoken_token_account.unwrap();

    let (amount, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    assert!(instruction_data.is_empty(), "incorrect instruction data");

    mint(
        &global_data_account,
        &user_comptoken_token_account,
        amount,
        &[&comptoken_mint_account, &user_comptoken_token_account, &global_data_account],
    )
}

#[cfg(not(feature = "testmode"))]
fn test_mint(_program_id: &Pubkey, _accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
    msg!("Invalid Instruction");
    Err(ProgramError::InvalidInstructionData)
}

pub fn mint_comptokens(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
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

pub fn initialize_comptoken_program(
    program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      [s, w] Payer (probably COMPTO's account)
    //      [] Comptoken Mint
    //      [w] Global Data Account (also mint authority)
    //      [w] Comptoken Interest Bank
    //      [w] Comptoken Verified Human UBI Bank
    //      [w] Comptoken Future UBI Bank
    //      [] Transfer Hook Program
    //      [w] Extra Account Metas Account
    //      [] Solana Program
    //      [] Solana Token 2022 Program
    //      [] Solana SlotHashes Sysvar
    //  data:
    //      8 bytes - lamports for global data
    //      8 bytes - lamports for interest bank
    //      8 bytes - lamports for verified human ubi bank
    //      8 bytes - lamports for future ubi bank

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            payer: Some((true, true)),
            comptoken_mint: Some((false, false)),
            global_data: Some((false, true)),
            interest_bank: Some((false, true)),
            verified_human_ubi_bank: Some((false, true)),
            future_ubi_bank: Some((false, true)),
            transfer_hook_program: Some((false, false)),
            extra_account_metas: Some((false, true)),
            solana_program: Some((false, false)),
            solana_token_2022_program: Some((false, false)),
            slothashes: Some((false, false)),
            ..Default::default()
        },
    )?;

    let payer_account = verified_accounts.payer.unwrap();
    let comptoken_mint = verified_accounts.comptoken_mint.unwrap();
    let global_data_account = verified_accounts.global_data.unwrap();
    let unpaid_interest_bank = verified_accounts.interest_bank.unwrap();
    let unpaid_verified_human_ubi_bank = verified_accounts.verified_human_ubi_bank.unwrap();
    let unpaid_future_ubi_bank = verified_accounts.future_ubi_bank.unwrap();
    let extra_account_metas_account = verified_accounts.extra_account_metas.unwrap();
    let solana_program = verified_accounts.solana_program.unwrap();
    let slothashes_account = verified_accounts.slothashes.unwrap();

    let (lamports_global_data, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    let (lamports_interest_bank, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    let (lamports_verified_human_ubi_bank, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    let (lamports_future_ubi_bank, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    assert!(instruction_data.is_empty(), "incorrect instruction data");

    msg!("Lamports global data: {:?}", lamports_global_data);
    msg!("Lamports interest bank: {:?}", lamports_interest_bank);
    msg!("Lamports verified human ubi bank: {:?}", lamports_verified_human_ubi_bank);
    msg!("Lamports future ubi bank: {:?}", lamports_future_ubi_bank);

    create_pda(
        &payer_account,
        &global_data_account,
        lamports_global_data,
        GLOBAL_DATA_ACCOUNT_SPACE,
        program_id,
        &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS],
    )?;
    msg!("created global data account");
    create_pda(
        &payer_account,
        &unpaid_interest_bank,
        lamports_interest_bank,
        COMPTOKEN_ACCOUNT_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_INTEREST_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created interest bank account");
    init_comptoken_account(&unpaid_interest_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized interest bank account");

    create_pda(
        &payer_account,
        &unpaid_verified_human_ubi_bank,
        lamports_interest_bank,
        COMPTOKEN_ACCOUNT_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created verified human ubi bank account");
    init_comptoken_account(&unpaid_verified_human_ubi_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized verified human ubi bank account");

    create_pda(
        &payer_account,
        &unpaid_future_ubi_bank,
        lamports_future_ubi_bank,
        COMPTOKEN_ACCOUNT_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_FUTURE_UBI_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created future ubi bank account");
    init_comptoken_account(&unpaid_future_ubi_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized future ubi bank account");

    let global_data: &mut GlobalData = (&global_data_account).into();
    global_data.initialize(&slothashes_account);

    let mut init_transfer_hook_instruction =
        spl_transfer_hook_interface::instruction::initialize_extra_account_meta_list(
            &TRANSFER_HOOK_ID,
            extra_account_metas_account.key,
            comptoken_mint.key,
            global_data_account.key,
            &[],
        );
    init_transfer_hook_instruction.accounts.push(AccountMeta::new(*payer_account.key, true));

    invoke_signed_verified(
        &init_transfer_hook_instruction,
        &[
            &extra_account_metas_account,
            &comptoken_mint,
            &global_data_account,
            &solana_program,
            &payer_account,
        ],
        &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS],
    )
}

pub fn create_user_data_account(
    program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8],
) -> ProgramResult {
    //  Account Order
    //      [s, w] payer account
    //      [s] User Solana Wallet
    //      [] User's Comptoken Token Account
    //      [w] User's Data Account
    //      [] Solana Program
    //  data:
    //      8 bytes - rent lamports
    //      8 bytes - space

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            payer: Some((true, true)),
            user_wallet: Some((true, false)),
            user_comptoken_token_account: Some((false, false)),
            user_data: Some((false, (false, true))),
            solana_program: Some((false, false)),
            ..Default::default()
        },
    )?;

    let payer_account = verified_accounts.payer.unwrap();
    let user_comptoken_wallet_account = verified_accounts.user_comptoken_token_account.unwrap();
    let user_data_account = verified_accounts.user_data.unwrap();
    let bump = verified_accounts.user_data_bump.unwrap();

    // find space and minimum rent required for account
    let (rent_lamports, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    let (space, instruction_data) =
        get_next_data(instruction_data, 8, |b| usize::from_le_bytes(b.try_into().expect("correct size")));
    assert!(instruction_data.is_empty(), "incorrect instruction data");

    msg!("space: {}", space);
    assert!(space >= USER_DATA_MIN_SIZE);
    assert!((space - USER_DATA_MIN_SIZE) % HASH_BYTES == 0);

    create_pda(
        &payer_account,
        &user_data_account,
        rent_lamports,
        space as u64,
        program_id,
        &[&[user_comptoken_wallet_account.key.as_ref(), &[bump]]],
    )?;

    // initialize data account
    let user_data: &mut UserData = (&user_data_account).into();
    user_data.initialize();

    Ok(())
}

pub fn daily_distribution_event(
    program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8],
) -> ProgramResult {
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

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            comptoken_mint: Some((false, false)),
            global_data: Some((false, true)),
            interest_bank: Some((false, true)),
            verified_human_ubi_bank: Some((false, true)),
            future_ubi_bank: Some((false, true)),
            solana_token_2022_program: Some((false, false)),
            slothashes: Some((false, false)),
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
            current_time > global_data.daily_distribution_data.last_daily_distribution_time + SEC_PER_DAY,
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

pub fn get_valid_blockhashes(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Global Data (also mint authority)
    //      [] Solana SlotHashes Sysvar
    //  data:
    //      None

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            global_data: Some((false, true)),
            slothashes: Some((false, false)),
            ..Default::default()
        },
    )?;

    let global_data_account = verified_accounts.global_data.unwrap();
    let slothashes_account = verified_accounts.slothashes.unwrap();

    assert!(instruction_data.is_empty(), "incorrect instruction data");

    let global_data: &mut GlobalData = (&global_data_account).into();
    let valid_blockhashes = &mut global_data.valid_blockhashes;

    valid_blockhashes.update(&slothashes_account);

    let mut data = Vec::from(global_data.valid_blockhashes.valid_blockhash.to_bytes());
    data.extend(global_data.valid_blockhashes.announced_blockhash.to_bytes());
    set_return_data(&data);
    Ok(())
}

pub fn get_owed_comptokens(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
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

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            comptoken_program: Some((false, false)),
            comptoken_mint: Some((false, false)),
            global_data: Some((false, false)),
            interest_bank: Some((false, true)),
            verified_human_ubi_bank: Some((false, true)),
            interest_bank_data: Some((false, false)),
            verified_human_ubi_bank_data: Some((false, false)),
            user_wallet: Some((true, false)),
            user_comptoken_token_account: Some((false, true)),
            user_data: Some((true, (false, true))),
            transfer_hook_program: Some((false, false)),
            extra_account_metas: Some((false, false)),
            solana_token_2022_program: Some((false, false)),
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

    assert!(instruction_data.is_empty(), "incorrect instruction data");

    let interest;
    let is_verified_human;
    let ubi;
    {
        let user_wallet_data = user_comptoken_token_account.try_borrow_data().unwrap();
        let user_comptoken_wallet = StateWithExtensions::<Account>::unpack(user_wallet_data.as_ref()).unwrap();
        let global_data: &mut GlobalData = (&global_data_account).into();
        let user_data: &mut UserData = (&user_data_account).into();
        is_verified_human = user_data.is_verified_human;

        // get days since last update
        let current_day = normalize_time(get_current_time());
        let days_since_last_update = (current_day - user_data.last_interest_payout_date) / SEC_PER_DAY;

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

pub fn realloc_user_data(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  Account Order
    //      [s, w] Payer Account
    //      [s] User Solana Wallet
    //      [] User's Comptoken Token Account
    //      [w] User's Data
    //      [] Solana Program
    //  data:
    //      8 bytes - rent lamports
    //      8 bytes - new size

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            payer: Some((true, true)),
            user_wallet: Some((true, false)),
            user_comptoken_token_account: Some((false, false)),
            user_data: Some((true, (false, true))),
            solana_program: Some((false, false)),
            ..Default::default()
        },
    )?;

    let payer_account = verified_accounts.payer.unwrap();
    let user_data_account = verified_accounts.user_data.unwrap();
    let system_program = verified_accounts.solana_program.unwrap();

    // find space and minimum rent required for account
    let (rent_lamports, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    let (new_size, instruction_data) =
        get_next_data(instruction_data, 8, |b| usize::from_le_bytes(b.try_into().expect("correct size")));
    assert!(instruction_data.is_empty(), "incorrect instruction data");

    // SAFETY: user_data_account is passed in from the runtime and is guaranteed to uphold the invariants original_data_len() and realloc assumes
    assert!(new_size <= unsafe { user_data_account.original_data_len() } + MAX_PERMITTED_DATA_INCREASE);
    assert!(user_data_account.data_len() < new_size);
    assert!((new_size - USER_DATA_MIN_SIZE) % HASH_BYTES == 0);
    let lamports = rent_lamports.saturating_sub(user_data_account.lamports());

    invoke_signed_verified(
        &solana_system_interface::instruction::transfer(payer_account.key, user_data_account.key, lamports),
        &[&user_data_account, &payer_account, &system_program],
        &[],
    )?;
    user_data_account.resize(new_size)
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
    //      [] Solana Token 2022 Program
    // data:
    //      8 bytes - rent lamports
    //      32 bytes - root hash
    //      32 bytes - nullifier hash
    //      256 bytes - proof

    let (rent_lamports, instruction_data) =
        get_next_data(instruction_data, 8, |b| u64::from_le_bytes(b.try_into().expect("correct size")));
    let (root_hash, instruction_data) = get_next_data(instruction_data, HASH_BYTES, |b| {
        Hash::new_from_array(b.try_into().expect("slice with incorrect length"))
    });
    let (nullifier_hash, instruction_data) = get_next_data(instruction_data, HASH_BYTES, |b| {
        Hash::new_from_array(b.try_into().expect("slice with incorrect length"))
    });
    let (proof, instruction_data) = get_next_data(instruction_data, WORLD_PROOF_LENGTH, |b| b);
    assert!(instruction_data.is_empty(), "incorrect instruction data");

    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            payer: Some((true, true)),
            comptoken_program: Some((false, false)),
            comptoken_mint: Some((false, false)),
            global_data: Some((false, true)),
            future_ubi_bank: Some((false, true)),
            future_ubi_bank_data: Some((false, false)),
            user_wallet: Some((true, false)),
            user_comptoken_token_account: Some((false, true)),
            user_data: Some((true, (false, true))),
            transfer_hook_program: Some((false, false)),
            extra_account_metas: Some((false, false)),
            world_id_program: Some((false, false)),
            world_id_root: Some((&root_hash, (false, false))),
            world_id_latest_root: Some((false, false)),
            world_id_config: Some((false, false)),
            world_id_nullifier: Some((&nullifier_hash, (false, false))),
            solana_program: Some((false, false)),
            solana_token_2022_program: Some((false, false)),
            ..Default::default()
        },
    )?;

    let payer = verified_accounts.payer.unwrap();
    let comptoken_program = verified_accounts.comptoken_program.unwrap();
    let comptoken_mint = verified_accounts.comptoken_mint.unwrap();
    let global_data_account = verified_accounts.global_data.unwrap();
    let unpaid_future_ubi_bank_account = verified_accounts.future_ubi_bank.unwrap();
    let unpaid_future_ubi_bank_data_pda = verified_accounts.future_ubi_bank_data.unwrap();
    let user_wallet = verified_accounts.user_wallet.unwrap();
    let user_comptoken_token_account = verified_accounts.user_comptoken_token_account.unwrap();
    let user_data_account = verified_accounts.user_data.unwrap();
    let transfer_hook_program = verified_accounts.transfer_hook_program.unwrap();
    let extra_account_metas_account = verified_accounts.extra_account_metas.unwrap();
    let world_id_program = verified_accounts.world_id_program.unwrap();
    let world_id_root = verified_accounts.world_id_root.unwrap();
    let world_id_latest_root = verified_accounts.world_id_latest_root.unwrap();
    let world_id_config = verified_accounts.world_id_config.unwrap();
    let world_id_nullifier = verified_accounts.world_id_nullifier.unwrap();
    let world_id_nullifier_bump = verified_accounts.world_id_nullifier_bump.unwrap();

    let user_data: &mut UserData = (&user_data_account).into();
    assert!(user_data.is_current(), "user data account is not current");

    // 1. verify unique nullifier hash
    // TODO what to do when people die?

    // pda creation will fail if the nullifier hash has already been used
    create_pda(
        &payer,
        &world_id_nullifier,
        rent_lamports,
        0,
        program_id,
        &[&[b"Nullifier", nullifier_hash.as_ref(), &[world_id_nullifier_bump]]],
    )?;

    // 2. cpi to world id program

    // self hosted apps don't have an app registered with the world id program, so they don't have an app id
    // instead they use a globally unique action to differentiate between different types of verifications
    // the suggested way to do this is to prefix the action with the program/app name
    const APP_ID: &str = "self_hosted";
    const ACTION: &str = "COMPTO-test"; // TODO: update this to the actual action
    let external_nullifier_hash = app_id_to_external_nullifier_hash(APP_ID, ACTION); // TODO: make this a constant
    let signal_bytes = user_wallet.key.to_bytes();
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
            AccountMeta::new_readonly(*world_id_root.key, false),
            AccountMeta::new_readonly(*world_id_latest_root.key, false),
            AccountMeta::new_readonly(*world_id_config.key, false),
        ],
        data: world_id_cpi_data,
    };

    // If the cpi fails, the program will fail, which will prevent the user from being verified, and not create the nullifier pda
    invoke_verified(
        &world_id_cpi_instruction,
        &[&world_id_program, &world_id_root, &world_id_latest_root, &world_id_config],
    )?;

    // 3. update user data

    user_data.is_verified_human = true;

    let global_data: &mut GlobalData = (&global_data_account).into();
    let verified_humans = global_data.daily_distribution_data.verified_humans;
    global_data.daily_distribution_data.verified_humans += 1;

    let unpaid_future_ubi_bank_data = unpaid_future_ubi_bank_account.try_borrow_data().unwrap();
    let unpaid_future_ubi_bank = StateWithExtensions::<Account>::unpack(&unpaid_future_ubi_bank_data).unwrap().base;

    let future_ubi_amount = unpaid_future_ubi_bank.amount;

    std::mem::drop(unpaid_future_ubi_bank_data); // drop mutable borrow to allow transfer

    if verified_humans <= FUTURE_UBI_VERIFIED_HUMANS {
        let amount = future_ubi_amount / (FUTURE_UBI_VERIFIED_HUMANS - verified_humans);
        transfer(
            &unpaid_future_ubi_bank_account,
            &user_comptoken_token_account,
            &comptoken_mint,
            &global_data_account,
            &[
                &extra_account_metas_account,
                &transfer_hook_program,
                &comptoken_program,
                &user_data_account,
                &unpaid_future_ubi_bank_account,
                &unpaid_future_ubi_bank_data_pda,
            ],
            amount,
        )?;
    }

    Ok(())
}

fn mint(
    mint_authority: &VerifiedAccountInfo, destination_wallet: &VerifiedAccountInfo, amount: u64,
    accounts: &[&VerifiedAccountInfo],
) -> ProgramResult {
    let instruction = mint_to(
        &spl_token_2022::id(),
        &COMPTOKEN_MINT_ADDRESS,
        destination_wallet.key,
        mint_authority.key,
        &[mint_authority.key],
        amount,
    )?;
    invoke_signed_verified(&instruction, accounts, &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS])
}

fn transfer<'a>(
    source: &VerifiedAccountInfo<'a>, destination: &VerifiedAccountInfo<'a>, mint: &VerifiedAccountInfo<'a>,
    global_data: &VerifiedAccountInfo<'a>, additional_accounts: &[&VerifiedAccountInfo<'a>], amount: u64,
) -> ProgramResult {
    let additional_accounts: Vec<_> = additional_accounts.iter().map(|account| account.0.clone()).collect();
    onchain::invoke_transfer_checked(
        &spl_token_2022::ID,
        source.0.clone(),
        mint.0.clone(),
        destination.0.clone(),
        global_data.0.clone(),
        &additional_accounts,
        amount,
        MINT_DECIMALS,
        &[COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS],
    )
}

fn init_comptoken_account<'a>(
    account: &VerifiedAccountInfo<'a>, owner: &VerifiedAccountInfo, signer_seeds: &[&[&[u8]]],
    mint: &VerifiedAccountInfo<'a>,
) -> ProgramResult {
    let init_comptoken_account_instr = spl_token_2022::instruction::initialize_account3(
        &spl_token_2022::ID,
        account.key,
        &COMPTOKEN_MINT_ADDRESS,
        owner.key,
    )?;
    invoke_signed_verified(&init_comptoken_account_instr, &[account, mint], signer_seeds)
}

fn store_hash(proof: ComptokenProof, data_account: &VerifiedAccountInfo, validhash: &ValidBlockhashes) {
    let user_data: &mut UserData = data_account.into();
    user_data.insert(&proof.hash, &validhash.valid_blockhash);
}

fn hash_to_field(val: &[u8]) -> [u8; 32] {
    let hash_result = keccak::hash(val).to_bytes();
    let big_int = u256::from_be_bytes(hash_result);
    let shifted: u256 = big_int >> 8;
    shifted.to_be_bytes()
}

fn app_id_to_external_nullifier_hash(app_id: &str, action: &str) -> [u8; 32] {
    let app_hash = hash_to_field(app_id.as_bytes());
    let mut combined = app_hash.to_vec();
    combined.extend_from_slice(action.as_bytes());
    hash_to_field(&combined)
}

fn get_next_data<'a, T>(data: &'a [u8], size: usize, converter: impl FnOnce(&'a [u8]) -> T) -> (T, &'a [u8]) {
    assert!(data.len() >= size, "not enough data");
    let (data, rest) = data.split_at(size);
    (converter(data), rest)
}
