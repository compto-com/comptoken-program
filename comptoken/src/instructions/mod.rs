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

trait InstructionData: Sized {
    fn from_instruction_data(instruction_data: &[u8]) -> Result<Self, solana_program::program_error::ProgramError>;
}
