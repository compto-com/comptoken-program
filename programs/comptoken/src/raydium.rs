use anchor_lang::prelude::*;

// idls/raydium_cp_swap.json has its `errors` section stripped: declare_program! emits an
// #[error_code] enum for it, and anchor's idl build keeps only the last error enum it sees,
// which would replace comptoken's errors in the generated IDL.
declare_program!(raydium_cp_swap);

pub use raydium_cp_swap::{program, *};
