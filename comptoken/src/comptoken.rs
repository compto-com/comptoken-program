mod comptoken_proof;
mod constants;
mod global_data;
mod verify_accounts;

extern crate bs58;

use spl_token_2022::{
    extension::StateWithExtensions,
    instruction::mint_to,
    onchain,
    solana_program::{
        account_info::AccountInfo, entrypoint, entrypoint::MAX_PERMITTED_DATA_INCREASE, hash::HASH_BYTES,
        instruction::AccountMeta, msg, program::set_return_data, program_error::ProgramError, pubkey::Pubkey,
        system_instruction,
    },
    state::{Account, Mint},
};

use comptoken_utils::{
    create_pda, get_current_time, invoke_signed_verified, normalize_time,
    user_data::{UserData, USER_DATA_MIN_SIZE},
    SEC_PER_DAY,
};

use comptoken_proof::ComptokenProof;
use constants::*;
use global_data::{daily_distribution_data::DailyDistributionValues, GlobalData};
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

    msg!("instruction_data: {:?}", instruction_data);

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

    let amount = u64::from_le_bytes(instruction_data[0..8].try_into().expect("correct size"));

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

    let global_data: &mut GlobalData = (&global_data_account).into();
    let proof = ComptokenProof::verify_submitted_proof(
        &user_comptoken_token_account,
        instruction_data,
        &global_data.valid_blockhashes,
    );

    msg!("data/accounts verified");
    let amount = 2;
    // now save the hash to the account, returning an error if the hash already exists
    store_hash(proof, &user_data_account);
    msg!("stored the proof");
    mint(
        &global_data_account,
        &user_comptoken_token_account,
        amount,
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

    msg!("instruction_data: {:?}", instruction_data);

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

    let first_8_bytes: [u8; 8] = instruction_data[0..8].try_into().unwrap();
    let lamports_global_data = u64::from_le_bytes(first_8_bytes);
    let lamports_interest_bank = u64::from_le_bytes(instruction_data[8..16].try_into().unwrap());
    let lamports_verified_human_ubi_bank = u64::from_le_bytes(instruction_data[16..24].try_into().unwrap());
    let lamports_future_ubi_bank = u64::from_le_bytes(instruction_data[24..32].try_into().unwrap());
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
    let rent_lamports = u64::from_le_bytes(instruction_data[0..8].try_into().expect("correct size"));
    let space = usize::from_le_bytes(instruction_data[8..16].try_into().expect("correct size"));
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
    program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8],
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

pub fn get_valid_blockhashes(program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Global Data (also mint authority)
    //      [] Solana SlotHashes Sysvar

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

    let global_data: &mut GlobalData = (&global_data_account).into();
    let valid_blockhashes = &mut global_data.valid_blockhashes;

    valid_blockhashes.update(&slothashes_account);

    let mut data = Vec::from(global_data.valid_blockhashes.valid_blockhash.to_bytes());
    data.extend(global_data.valid_blockhashes.announced_blockhash.to_bytes());
    set_return_data(&data);
    Ok(())
}

pub fn get_owed_comptokens(program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
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
    let interest_data_pda = verified_accounts.interest_bank_data.unwrap();
    let user_comptoken_token_account = verified_accounts.user_comptoken_token_account.unwrap();
    let user_data_account = verified_accounts.user_data.unwrap();
    let transfer_hook_program = verified_accounts.transfer_hook_program.unwrap();
    let extra_account_metas_account = verified_accounts.extra_account_metas.unwrap();

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
            (interest, ubi) = global_data
                .daily_distribution_data
                .get_distributions_for_n_days(days_since_last_update as usize, user_comptoken_wallet.base.amount);
        } else {
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
                &interest_data_pda,
            ],
            interest,
        )?;
    }
    // get ubi if verified
    if is_verified_human && ubi > 0 {
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
                &interest_data_pda,
            ],
            ubi,
        )?;
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
    let rent_lamports = u64::from_le_bytes(instruction_data[0..8].try_into().expect("correct size"));
    let new_size = usize::from_le_bytes(instruction_data[8..16].try_into().expect("correct size"));

    // SAFETY: user_data_account is passed in from the runtime and is guaranteed to uphold the invariants original_data_len() and realloc assumes
    assert!(new_size <= unsafe { user_data_account.original_data_len() } + MAX_PERMITTED_DATA_INCREASE);
    assert!(user_data_account.data_len() < new_size);
    assert!((new_size - USER_DATA_MIN_SIZE) % HASH_BYTES == 0);
    let lamports = rent_lamports.saturating_sub(user_data_account.lamports());

    invoke_signed_verified(
        &system_instruction::transfer(payer_account.key, user_data_account.key, lamports),
        &[&user_data_account, &payer_account, &system_program],
        &[],
    )?;
    user_data_account.realloc(new_size, false)
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

fn store_hash(proof: ComptokenProof, data_account: &VerifiedAccountInfo) {
    let user_data: &mut UserData = data_account.into();
    user_data.insert(&proof.hash, &proof.recent_block_hash)
}
