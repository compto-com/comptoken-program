use solana_program::{
    program::set_return_data,
    {account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey},
};

use crate::{
    global_data::GlobalData,
    instructions::InstructionData,
    verify_accounts::{verify_accounts, AccountMetaType, AccountsToVerify},
};

struct GetValidBlockhashesData {}

impl InstructionData for GetValidBlockhashesData {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError> {
        if !instruction_data.is_empty() {
            return Err(solana_program::program_error::ProgramError::InvalidInstructionData);
        }
        // No data expected for this instruction
        Ok(GetValidBlockhashesData {})
    }
}

pub fn get_valid_blockhashes(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Global Data (also mint authority)
    //      [] Solana SlotHashes Sysvar
    //  data:
    //      None

    #[rustfmt::skip]
    let verified_accounts = verify_accounts(
        accounts,
        program_id,
        AccountsToVerify {
            global_data: Some(AccountMetaType::Writable),
            slothashes:  Some(AccountMetaType::None),
            ..Default::default()
        },
    )?;

    let global_data_account = verified_accounts.global_data.unwrap();
    let slothashes_account = verified_accounts.slothashes.unwrap();

    let _ = GetValidBlockhashesData::from_instruction_data(instruction_data)?;

    let global_data: &mut GlobalData = (&global_data_account).into();
    let valid_blockhashes = &mut global_data.valid_blockhashes;

    valid_blockhashes.update(&slothashes_account);

    let mut data = Vec::from(global_data.valid_blockhashes.valid_blockhash.to_bytes());
    data.extend(global_data.valid_blockhashes.announced_blockhash.to_bytes());
    set_return_data(&data);
    Ok(())
}
