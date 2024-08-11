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
        account_info::{next_account_info, AccountInfo},
        entrypoint,
        entrypoint::MAX_PERMITTED_DATA_INCREASE,
        hash::HASH_BYTES,
        msg,
        program::set_return_data,
        program_error::ProgramError,
        pubkey::Pubkey,
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
    COMPTOKEN_MINT_ADDRESS, COMPTO_GLOBAL_DATA_ACCOUNT_SEEDS, COMPTO_INTEREST_BANK_ACCOUNT_SEEDS,
    COMPTO_UBI_BANK_ACCOUNT_SEEDS,
};

const INTEREST_BANK_SPACE: u64 = 256; // TODO get actual size
const UBI_BANK_SPACE: u64 = 256; // TODO get actual size

// program entrypoint's implementation
pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    msg!("instruction_data: {:?}", instruction_data);
    match instruction_data[0] {
        0 => {
            msg!("Test Mint");
            test_mint(program_id, accounts, &instruction_data[1..])
        }
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
        _ => {
            msg!("Invalid Instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

pub fn test_mint(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Mint account
    //      [] Testuser Comptoken Wallet
    //      [] Global Data (also Mint Authority)
    //      [] Solana Token 2022
    //      [s] Testuser Solana Wallet

    msg!("instruction_data: {:?}", instruction_data);

    let account_info_iter = &mut accounts.iter();
    let comptoken_mint_account = next_account_info(account_info_iter)?;
    msg!("Comptoken Mint Key: {:?}", comptoken_mint_account.key);
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    msg!("User Comptoken Wallet Key: {:?}", user_comptoken_wallet_account.key);
    let global_data_account = next_account_info(account_info_iter)?;
    msg!("Global Data Key: {:?}", global_data_account.key);
    let _solana_token_account = next_account_info(account_info_iter)?;
    msg!("Solana Token Key: {:?}", _solana_token_account.key);
    let testuser_solana_wallet_account = next_account_info(account_info_iter)?;

    let comptoken_mint_account = verify_comptoken_mint(comptoken_mint_account, true);
    let testuser_solana_wallet_account =
        VerifiedAccountInfo::verify_account_signer_or_writable(testuser_solana_wallet_account, true, false);
    let user_comptoken_wallet_account = verify_user_comptoken_wallet_account(
        user_comptoken_wallet_account,
        &testuser_solana_wallet_account,
        false,
        true,
    );
    let global_data_account = verify_global_data_account(global_data_account, program_id, false);

    let amount = 2;

    mint(
        &global_data_account,
        &user_comptoken_wallet_account,
        amount,
        &[&comptoken_mint_account, &user_comptoken_wallet_account, &global_data_account],
    )
}

pub fn mint_comptokens(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Mint
    //      [w] User Comptoken Wallet
    //      [] Global Data (also Mint Authority)
    //      [w] User Data
    //      [] Solana Token 2022
    //      [s] User Solana Wallet

    let account_info_iter = &mut accounts.iter();
    let _comptoken_mint_account = next_account_info(account_info_iter)?;
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let user_data_account = next_account_info(account_info_iter)?;
    let _solana_token_account = next_account_info(account_info_iter)?;
    let user_solana_wallet_account = next_account_info(account_info_iter)?;

    let comptoken_mint_account = verify_comptoken_mint(_comptoken_mint_account, true);
    let global_data_account = verify_global_data_account(global_data_account, program_id, false);
    let global_data: &mut GlobalData = (&global_data_account).into();
    let user_solana_wallet_account =
        VerifiedAccountInfo::verify_account_signer_or_writable(user_solana_wallet_account, true, false);
    let user_comptoken_wallet_account =
        verify_user_comptoken_wallet_account(user_comptoken_wallet_account, &user_solana_wallet_account, false, true);
    let proof = ComptokenProof::verify_submitted_proof(
        &user_comptoken_wallet_account,
        instruction_data,
        &global_data.valid_blockhashes,
    );
    let (user_data_account, _) =
        verify_user_data_account(user_data_account, &user_comptoken_wallet_account, program_id, true);

    msg!("data/accounts verified");
    let amount = 2;
    // now save the hash to the account, returning an error if the hash already exists
    store_hash(proof, &user_data_account);
    msg!("stored the proof");
    mint(
        &global_data_account,
        &user_comptoken_wallet_account,
        amount,
        &[&comptoken_mint_account, &user_comptoken_wallet_account, &global_data_account],
    )?;

    Ok(())
}

pub fn initialize_comptoken_program(
    program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8],
) -> ProgramResult {
    //  accounts order:
    //      [s, w] Payer (probably COMPTO's account)
    //      [w] Global Data Account (also mint authority)
    //      [w] Comptoken Interest Bank
    //      [w] Comptoken UBI Bank
    //      [] Comptoken Mint
    //      [] Solana Program
    //      [] Solana Token 2022 Program
    //      [] Solana SlotHashes Sysvar

    msg!("instruction_data: {:?}", instruction_data);

    let account_info_iter = &mut accounts.iter();
    let payer_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let unpaid_interest_bank = next_account_info(account_info_iter)?;
    let unpaid_ubi_bank = next_account_info(account_info_iter)?;
    let comptoken_mint = next_account_info(account_info_iter)?;
    let _solana_program = next_account_info(account_info_iter)?;
    let _token_2022_program = next_account_info(account_info_iter)?;
    let slot_hashes_account = next_account_info(account_info_iter)?;

    let payer_account = verify_payer_account(payer_account);
    let global_data_account = verify_global_data_account(global_data_account, program_id, true);
    let unpaid_interest_bank = verify_interest_bank_account(unpaid_interest_bank, program_id, true);
    let unpaid_ubi_bank = verify_ubi_bank_account(unpaid_ubi_bank, program_id, true);
    let comptoken_mint = verify_comptoken_mint(comptoken_mint, false);
    let slot_hashes_account = verify_slothashes_account(slot_hashes_account);

    let first_8_bytes: [u8; 8] = instruction_data[0..8].try_into().unwrap();
    let lamports_global_data = u64::from_le_bytes(first_8_bytes);
    let lamports_interest_bank = u64::from_le_bytes(instruction_data[8..16].try_into().unwrap());
    let lamports_ubi_bank = u64::from_le_bytes(instruction_data[16..24].try_into().unwrap());
    msg!("Lamports global data: {:?}", lamports_global_data);
    msg!("Lamports interest bank: {:?}", lamports_interest_bank);
    msg!("Lamports ubi bank: {:?}", lamports_ubi_bank);

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
        INTEREST_BANK_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_INTEREST_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created interest bank account");
    init_comptoken_account(&unpaid_interest_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized interest bank account");
    create_pda(
        &payer_account,
        &unpaid_ubi_bank,
        lamports_interest_bank,
        UBI_BANK_SPACE,
        &spl_token_2022::ID,
        &[COMPTO_UBI_BANK_ACCOUNT_SEEDS],
    )?;
    msg!("created ubi bank account");
    init_comptoken_account(&unpaid_ubi_bank, &global_data_account, &[], &comptoken_mint)?;
    msg!("initialized ubi bank account");

    let global_data: &mut GlobalData = (&global_data_account).into();
    global_data.initialize(&slot_hashes_account);

    Ok(())
}

pub fn create_user_data_account(
    program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8],
) -> ProgramResult {
    //  Account Order
    //      [s, w] User's Solana Wallet
    //      [w] User's Data
    //      [] User's Comptoken Wallet
    //      [] Solana Program
    //      [s] User Solana Wallet

    let account_info_iter = &mut accounts.iter();

    let payer_account = next_account_info(account_info_iter)?;
    let user_data_account = next_account_info(account_info_iter)?;
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    let _solana_program = next_account_info(account_info_iter)?;
    let user_solana_wallet_account =
        VerifiedAccountInfo::verify_account_signer_or_writable(next_account_info(account_info_iter)?, true, false);

    // find space and minimum rent required for account
    let rent_lamports = u64::from_le_bytes(instruction_data[0..8].try_into().expect("correct size"));
    let space = usize::from_le_bytes(instruction_data[8..16].try_into().expect("correct size"));
    msg!("space: {}", space);
    assert!(space >= USER_DATA_MIN_SIZE);
    assert!((space - USER_DATA_MIN_SIZE) % HASH_BYTES == 0);

    let payer_account = verify_payer_account(payer_account);
    let user_comptoken_wallet_account =
        verify_user_comptoken_wallet_account(user_comptoken_wallet_account, &user_solana_wallet_account, false, false);
    let (user_data_account, bump) = VerifiedAccountInfo::verify_pda(
        user_data_account,
        program_id,
        &[user_comptoken_wallet_account.key.as_ref()],
        false,
        true,
    );

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
    //      [w] Comptoken UBI Bank
    //      [] Solana Token Program
    //      [] Solana SlotHashes Sysvar

    let account_info_iter = &mut accounts.iter();
    let comptoken_mint_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let unpaid_interest_bank = next_account_info(account_info_iter)?;
    let unpaid_ubi_bank = next_account_info(account_info_iter)?;
    let _solana_token_account = next_account_info(account_info_iter)?;
    let slot_hashes_account = next_account_info(account_info_iter)?;

    let comptoken_mint_account = verify_comptoken_mint(comptoken_mint_account, false);
    let global_data_account = verify_global_data_account(global_data_account, program_id, true);
    let unpaid_interest_bank = verify_interest_bank_account(unpaid_interest_bank, program_id, true);
    let unpaid_ubi_bank = verify_ubi_bank_account(unpaid_ubi_bank, program_id, true);
    let slot_hashes_account = verify_slothashes_account(slot_hashes_account);

    let interest_daily_distribution;
    let ubi_daily_distribution;
    // scope to prevent reborrowing issues
    {
        let mut global_data_account_data = global_data_account.try_borrow_mut_data().unwrap();
        let global_data: &mut GlobalData = global_data_account_data.as_mut().into();
        let mint_data = comptoken_mint_account.try_borrow_data().unwrap();
        let comptoken_mint = StateWithExtensions::<Mint>::unpack(mint_data.as_ref()).unwrap();

        let current_time = get_current_time();
        assert!(
            current_time > global_data.daily_distribution_data.last_daily_distribution_time + SEC_PER_DAY,
            "daily distribution already called today"
        );

        DailyDistributionValues {
            interest_distributed: interest_daily_distribution,
            ubi_distributed: ubi_daily_distribution,
        } = global_data.daily_distribution_event(comptoken_mint.base, &slot_hashes_account);
    }
    // mint to banks
    mint(
        &global_data_account,
        &unpaid_interest_bank,
        interest_daily_distribution,
        &[&comptoken_mint_account, &global_data_account, &unpaid_interest_bank],
    )?;
    mint(
        &global_data_account,
        &unpaid_ubi_bank,
        ubi_daily_distribution,
        &[&comptoken_mint_account, &global_data_account, &unpaid_ubi_bank],
    )?;

    Ok(())
}

pub fn get_valid_blockhashes(program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Global Data (also mint authority)
    //      [] Solana SlotHashes Sysvar

    let account_info_iter = &mut accounts.iter();
    let global_data_account = next_account_info(account_info_iter)?;
    let slot_hashes_account = next_account_info(account_info_iter)?;

    let global_data_account = verify_global_data_account(global_data_account, program_id, true);
    let slot_hashes_account = verify_slothashes_account(slot_hashes_account);

    let global_data: &mut GlobalData = (&global_data_account).into();
    let valid_blockhashes = &mut global_data.valid_blockhashes;

    valid_blockhashes.update(&slot_hashes_account);

    let mut data = Vec::from(global_data.valid_blockhashes.valid_blockhash.to_bytes());
    data.extend(global_data.valid_blockhashes.announced_blockhash.to_bytes());
    set_return_data(&data);
    Ok(())
}

pub fn get_owed_comptokens(program_id: &Pubkey, accounts: &[AccountInfo], _instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] User's Data
    //      [w] User's Comptoken Wallet
    //      [] Comptoken Mint
    //      [] Comptoken Global Data (also mint authority)
    //      [w] Comptoken Interest Bank
    //      [w] Comptoken UBI Bank
    //      [] Solana Token 2022 Program
    //      [] Extra Account Metas Account
    //      [] Transfer Hook Program
    //      [] Comptoken Program
    //      [] Interest Bank Data PDA (doesn't actually exist)
    //      [] UBI Bank Data PDA (doesn't actually exist)
    //      [s] User Solana Wallet

    let account_info_iter = &mut accounts.iter();
    let user_data_account = next_account_info(account_info_iter)?;
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    let comptoken_mint_account = next_account_info(account_info_iter)?;
    let global_data_account = next_account_info(account_info_iter)?;
    let unpaid_interest_bank = next_account_info(account_info_iter)?;
    let unpaid_ubi_bank = next_account_info(account_info_iter)?;
    let _solana_token_account = next_account_info(account_info_iter)?;
    let extra_account_metas_account = next_account_info(account_info_iter)?;
    let transfer_hook_program = next_account_info(account_info_iter)?;
    let compto_program = next_account_info(account_info_iter)?;
    let interest_data_pda /* not a real account */ = next_account_info(account_info_iter)?;
    let ubi_data_pda /* not a real account */ = next_account_info(account_info_iter)?;
    let user_solana_wallet_account =
        VerifiedAccountInfo::verify_account_signer_or_writable(next_account_info(account_info_iter)?, true, false);

    let user_comptoken_wallet_account =
        verify_user_comptoken_wallet_account(user_comptoken_wallet_account, &user_solana_wallet_account, false, true);
    let (user_data_account, _) =
        verify_user_data_account(user_data_account, &user_comptoken_wallet_account, program_id, true);
    let comptoken_mint_account = verify_comptoken_mint(comptoken_mint_account, false);
    let global_data_account = verify_global_data_account(global_data_account, program_id, false);
    let unpaid_interest_bank = verify_interest_bank_account(unpaid_interest_bank, program_id, true);
    let unpaid_ubi_bank = verify_ubi_bank_account(unpaid_ubi_bank, program_id, true);
    let transfer_hook_program = verify_transfer_hook_program(transfer_hook_program);
    let extra_account_metas_account = verify_extra_account_metas_account(
        extra_account_metas_account,
        &comptoken_mint_account,
        &transfer_hook_program,
    );
    let compto_program = VerifiedAccountInfo::verify_specific_address(compto_program, program_id, false, false);
    let interest_data_pda = VerifiedAccountInfo::verify_pda(
        interest_data_pda,
        program_id,
        &[unpaid_interest_bank.key.as_ref()],
        false,
        false,
    )
    .0;
    let ubi_data_pda =
        VerifiedAccountInfo::verify_pda(ubi_data_pda, program_id, &[unpaid_ubi_bank.key.as_ref()], false, false).0;

    let interest;
    let is_verified_human;
    {
        let user_wallet_data = user_comptoken_wallet_account.try_borrow_data().unwrap();
        let user_comptoken_wallet = StateWithExtensions::<Account>::unpack(user_wallet_data.as_ref()).unwrap();
        let global_data: &mut GlobalData = (&global_data_account).into();
        let user_data: &mut UserData = (&user_data_account).into();

        // get days since last update
        let current_day = normalize_time(get_current_time());
        let days_since_last_update = (current_day - user_data.last_interest_payout_date) / SEC_PER_DAY;

        msg!("total before interest: {}", user_comptoken_wallet.base.amount);
        // get interest
        interest = global_data
            .daily_distribution_data
            .apply_n_interests(days_since_last_update as usize, user_comptoken_wallet.base.amount)
            - user_comptoken_wallet.base.amount;

        msg!("Interest: {}", interest);
        user_data.last_interest_payout_date = current_day;
        is_verified_human = user_data.is_verified_human;
    }

    transfer(
        &unpaid_interest_bank,
        &user_comptoken_wallet_account,
        &comptoken_mint_account,
        &global_data_account,
        &[
            &extra_account_metas_account,
            &transfer_hook_program,
            &compto_program,
            &user_data_account,
            &interest_data_pda,
        ],
        interest,
    )?;

    // get ubi if verified
    if is_verified_human {
        transfer(
            &unpaid_ubi_bank,
            &user_comptoken_wallet_account,
            &comptoken_mint_account,
            &global_data_account,
            &[
                &extra_account_metas_account,
                &transfer_hook_program,
                &compto_program,
                &user_data_account,
                &ubi_data_pda,
            ],
            0, // TODO figure out correct amount
        )?;
    }

    Ok(())
}

pub fn realloc_user_data(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  Account Order
    //      [s, w] User's Solana Wallet
    //      [w] User's Data
    //      [] User's Comptoken Wallet
    //      [] Solana Program
    //      [s] User Solana Wallet

    let account_info_iter = &mut accounts.iter();

    let payer_account = next_account_info(account_info_iter)?;
    let user_data_account = next_account_info(account_info_iter)?;
    let user_comptoken_wallet_account = next_account_info(account_info_iter)?;
    let system_program = VerifiedAccountInfo::verify_specific_address(
        next_account_info(account_info_iter)?,
        &solana_program::system_program::ID,
        false,
        false,
    );
    let user_solana_wallet_account =
        VerifiedAccountInfo::verify_account_signer_or_writable(next_account_info(account_info_iter)?, true, false);

    let payer_account = verify_payer_account(payer_account);
    let user_comptoken_wallet_account =
        verify_user_comptoken_wallet_account(user_comptoken_wallet_account, &user_solana_wallet_account, false, false);
    let (user_data_account, _) =
        verify_user_data_account(user_data_account, &user_comptoken_wallet_account, program_id, true);

    // find space and minimum rent required for account
    let rent_lamports = u64::from_le_bytes(instruction_data[0..8].try_into().expect("correct size"));
    let new_size = usize::from_le_bytes(instruction_data[8..16].try_into().expect("correct size"));

    let user_data: &mut UserData = (&user_data_account).into();

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
