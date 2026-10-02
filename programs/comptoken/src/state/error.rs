use anchor_lang::prelude::*;

#[error_code]
pub enum ComptokenError {
    #[msg("Nullifier has already been used")]
    NullifierAlreadyUsed,

    #[msg("User data account is not current")]
    UserDataNotCurrent,

    #[msg("Invalid mining proof submitted")]
    InvalidMiningProof,

    #[msg("Duplicate mining proof submitted")]
    DuplicateMiningProof,

    #[msg("User data proofs capacity exceeded, consider increasing capacity")]
    UserDataProofsCapacityExceeded,

    #[msg("Invalid nullifier owner")]
    InvalidNullifierOwner,

    #[msg("Invalid nullifier hash for user data")]
    InvalidNullifierHash,

    #[msg("Invalid capacity for resizing user data account")]
    InvalidCapacity,

    #[msg("Insufficient funds in token account")]
    InsufficientFunds,

    #[msg("Account has already been initialized")]
    AccountAlreadyInitialized,

    #[msg("Stale valid blockhash")]
    StaleValidBlockhash,
}
