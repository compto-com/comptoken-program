use solana_program::{account_info::AccountInfo, pubkey::Pubkey};

mod collect;
pub use collect::*;

mod create_user_data_account;
pub use create_user_data_account::*;

mod daily_distribution;
pub use daily_distribution::*;

mod flag_stale_account;
pub use flag_stale_account::*;

mod get_valid_blockhashes;
pub use get_valid_blockhashes::*;

mod initialize;
pub use initialize::*;

mod mint_unchecked;
pub use mint_unchecked::*;

mod resize_user_data_account;
pub use resize_user_data_account::*;

mod reverify_human;
pub use reverify_human::*;

mod submit_proof;
pub use submit_proof::*;

mod unverify_human;
pub use unverify_human::*;

mod unverify_human_2;
pub use unverify_human_2::*;

mod verify_human;
pub use verify_human::*;

trait InstructionData: Sized {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError>;
}

trait InstructionAccounts<'a>: Sized {
    type AdditionalVerificationData;

    fn verify_accounts(
        accounts: &[AccountInfo<'a>], program_id: &Pubkey, additional_data: Self::AdditionalVerificationData,
    ) -> Result<Self, solana_program::program_error::ProgramError>;
}
