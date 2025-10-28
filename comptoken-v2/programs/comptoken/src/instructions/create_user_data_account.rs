use anchor_lang::prelude::*;

use crate::{constants::USER_DATA_SEED, state::user_data::UserData};

#[derive(Accounts)]
#[instruction(args: CreateUserDataAccountArgs)]
pub struct CreateUserDataAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub user_wallet: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = UserData::space(args.capacity()),
        seeds = [USER_DATA_SEED, user_wallet.key().as_ref()],
        bump,
    )]
    pub user_data: Account<'info, UserData>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateUserDataAccountArgs {
    capacity: u64,
}

impl CreateUserDataAccountArgs {
    fn capacity(&self) -> usize {
        self.capacity as usize
    }
}

pub fn create_user_data_account(ctx: Context<CreateUserDataAccount>, args: CreateUserDataAccountArgs) -> Result<()> {
    let user_data = &mut ctx.accounts.user_data;
    user_data.init(args.capacity());
    Ok(())
}
