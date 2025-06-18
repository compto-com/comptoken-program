use solana_program::{
    program::set_return_data,
    {account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey},
};

use comptoken_utils::verify_accounts::VerifiedAccountInfo;

use crate::{
    data::global_data::GlobalData,
    instructions::{InstructionAccounts, InstructionData},
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

#[rustfmt::skip]
struct GetValidBlockhashesAccounts<'a> {
    global_data_account: VerifiedAccountInfo<'a>,
    slothashes:  VerifiedAccountInfo<'a>,
}

impl<'a> InstructionAccounts<'a> for GetValidBlockhashesAccounts<'a> {
    type AdditionalVerificationData = ();

    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, _additional_data: Self::AdditionalVerificationData,
    ) -> Result<Self, solana_program::program_error::ProgramError> {
        #[rustfmt::skip]
        let verified_accounts = verify_accounts(
            accounts,
            program_id,
            AccountsToVerify {
                global_data_account: Some(AccountMetaType::Writable),
                slothashes:          Some(AccountMetaType::None),
                ..Default::default()
            },
        )?;

        Ok(GetValidBlockhashesAccounts {
            global_data_account: verified_accounts.global_data_account.unwrap(),
            slothashes: verified_accounts.slothashes.unwrap(),
        })
    }
}

pub fn get_valid_blockhashes(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    //  accounts order:
    //      [w] Comptoken Global Data (also mint authority)
    //      [] Solana SlotHashes Sysvar
    //  data:
    //      None

    let GetValidBlockhashesAccounts { global_data_account, slothashes } =
        GetValidBlockhashesAccounts::verify_accounts(accounts, program_id, ())?;

    let _ = GetValidBlockhashesData::from_instruction_data(instruction_data)?;

    let global_data: &mut GlobalData = (&global_data_account).into();
    let valid_blockhashes = &mut global_data.valid_blockhashes;

    valid_blockhashes.update(&slothashes);

    let mut data = Vec::from(global_data.valid_blockhashes.valid_blockhash.to_bytes());
    data.extend(global_data.valid_blockhashes.announced_blockhash.to_bytes());
    set_return_data(&data);
    Ok(())
}
