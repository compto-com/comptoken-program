use solana_program::{account_info::AccountInfo, pubkey::Pubkey};

mod mint_unchecked;
pub use mint_unchecked::*;

mod submit_proof;
pub use submit_proof::*;

mod initialize;
pub use initialize::*;

mod create_user_data_account;
pub use create_user_data_account::*;

mod daily_distribution;
pub use daily_distribution::*;

mod get_valid_blockhashes;
pub use get_valid_blockhashes::*;

mod collect;
pub use collect::*;

mod resize_user_data_account;
pub use resize_user_data_account::*;

mod verify_human;
pub use verify_human::*;

mod flag_stale_account;
pub use flag_stale_account::*;

trait InstructionData: Sized {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError>;
}

trait InstructionAccounts<'a>: Sized {
    type AdditionalVerificationData;

    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, additional_data: Self::AdditionalVerificationData,
    ) -> Result<Self, solana_program::program_error::ProgramError>;
}
