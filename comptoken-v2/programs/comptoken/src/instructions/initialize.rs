use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{
        initialize_mint2,
        spl_token_2022::{extension::ExtensionType, pod::PodMint},
        InitializeMint2, Token2022,
    },
    token_interface::{non_transferable_mint_initialize, Mint, NonTransferableMintInitialize},
};

use crate::{global_data::GlobalData, GLOBAL_DATA_SEED, LOCKED_MINT_SEED, MINT_DECIMALS, UNLOCKED_MINT_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = ExtensionType::try_calculate_account_len::<PodMint>(&[ExtensionType::NonTransferable]).expect("NonTransferable extension size to be constant"),
        seeds = [LOCKED_MINT_SEED],
        bump,
        owner = token_program.key(),
    )]
    /// CHECK: This account will be initialized as a Token2022 mint with NonTransferable extension
    pub mint_locked: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        mint::authority = crate::id(),
        mint::decimals = MINT_DECIMALS,
        seeds = [UNLOCKED_MINT_SEED],
        bump,
        mint::token_program = token_program,
    )]
    pub mint_unlocked: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = std::mem::size_of::<GlobalData>() + 8,
        seeds = [GLOBAL_DATA_SEED],
        bump,
    )]
    pub global_data: AccountLoader<'info, GlobalData>,

    /// CHECK: SlotHashes sysvar account
    #[account(constraint = slot_hashes.key() == anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>, // Sysvar account, but Sysvar<'_, SlotHashes> deserializes it, which fails

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    // Initialize the non-transferable extension for the locked mint
    non_transferable_mint_initialize(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        NonTransferableMintInitialize {
            token_program_id: ctx.accounts.token_program.to_account_info(),
            mint: ctx.accounts.mint_locked.to_account_info(),
        },
    ))?;

    // Initialize the mint after the extension
    initialize_mint2(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            InitializeMint2 { mint: ctx.accounts.mint_locked.to_account_info() },
        ),
        MINT_DECIMALS,
        &crate::id(),
        None,
    )?;

    // Initialize global data
    ctx.accounts.global_data.load_init()?.init(&ctx.accounts.slot_hashes);

    Ok(())
}
