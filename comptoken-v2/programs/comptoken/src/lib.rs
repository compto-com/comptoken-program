pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

use constants::*;
use instructions::*;
use state::*;
use utils::*;

declare_id!("F9SW7dcgDHV6QGYcFHyqKtykAdsHvL4BJYA2YP4YkEJX");

#[program]
pub mod comptoken {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::initialize(ctx)
    }
}
