use anchor_lang::prelude::*;

use crate::{
    constants::{GLOBAL_DATA_SEED, USER_DATA_SEED},
    state::{global_data::GlobalData, user_data::UserData},
};

#[derive(Accounts)]
#[instruction(args: ResizeUserDataAccountArgs)]
pub struct ResizeUserDataAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub user_wallet: Signer<'info>,

    #[account(
        mut,
        realloc = UserData::space(args.new_capacity()),
        realloc::payer = payer,
        realloc::zero = false, // 
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    #[account(seeds = [GLOBAL_DATA_SEED], bump)]
    pub global_data: AccountLoader<'info, GlobalData>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ResizeUserDataAccountArgs {
    new_capacity: u64,
}

impl ResizeUserDataAccountArgs {
    fn new_capacity(&self) -> usize {
        self.new_capacity as usize
    }
}

pub fn resize_user_data_account(ctx: Context<ResizeUserDataAccount>, args: ResizeUserDataAccountArgs) -> Result<()> {
    let user_data = &mut ctx.accounts.user_data;
    let global_data = ctx.accounts.global_data.load()?;

    let recent_blockhash = global_data.valid_blockhashes.valid_blockhash;

    user_data.update_recent_blockhash(recent_blockhash);

    let len = user_data.proofs.len();
    assert!(args.new_capacity() >= len, "New capacity must be at least the current number of proofs"); // should we enforce stricter shrink rules?

    // this may be effectively handled by the serializer/deserializer, but just to be safe
    // reserve_exact allocates exactly the requested *additional* capacity,
    // so we first shrink to fit to remove any excess capacity
    user_data.proofs.shrink_to_fit();
    user_data.proofs.reserve_exact(args.new_capacity() - len);

    Ok(())
}
