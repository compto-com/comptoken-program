use anchor_lang::prelude::*;

use crate::{error::SolanaWorldIDProgramError, state::GuardianSignaturesBuffer};

#[derive(Accounts)]
#[instruction(_guardian_signatures: Vec<[u8; 66]>, total_signatures: u8)]
pub struct PostSignatures<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + GuardianSignaturesBuffer::compute_size(usize::from(total_signatures))
    )]
    guardian_signatures_buffer: Account<'info, GuardianSignaturesBuffer>,

    system_program: Program<'info, System>,
}

impl<'info> PostSignatures<'info> {
    pub fn constraints(new_guardian_signatures: &[[u8; 66]]) -> Result<()> {
        // Signatures should not be empty, since this is used by is_initialized.
        // Additionally, there is no reason for it to be.
        require!(!new_guardian_signatures.is_empty(), SolanaWorldIDProgramError::EmptyGuardianSignatures);

        // Done.
        Ok(())
    }
}

/// Creates or appends to a GuardianSignaturesBuffer account for subsequent use by update_root_with_query.
/// This is necessary as the Wormhole query response (220 bytes)
/// and 13 guardian signatures (a quorum of the current 19 mainnet guardians, 66 bytes each)
/// alongside the required accounts is larger than the transaction size limit on Solana (1232 bytes).
///
/// This instruction allows for the initial payer to append additional signatures to the account by calling the instruction again. If
/// the quorum of signatures from the current guardian set grows larger than can fit into a single transaction, multiple calls to this
/// instruction can be made to store all signatures needed for verification in the GuardianSignaturesBuffer account.
///
/// The GuardianSignaturesBuffer account can be closed by anyone with a successful update_root_with_query instruction
/// or by the initial payer via close_signatures, either of which will refund the initial payer.
#[access_control(PostSignatures::constraints(&new_guardian_signatures))]
pub fn post_signatures(
    ctx: Context<PostSignatures>, mut new_guardian_signatures: Vec<[u8; 66]>, _total_signatures: u8,
) -> Result<()> {
    if ctx.accounts.guardian_signatures_buffer.is_initialized() {
        require_eq!(
            ctx.accounts.guardian_signatures_buffer.refund_recipient,
            ctx.accounts.payer.key(),
            SolanaWorldIDProgramError::WriteAuthorityMismatch
        );
        ctx.accounts
            .guardian_signatures_buffer
            .guardian_signatures
            .append(&mut new_guardian_signatures);
    } else {
        ctx.accounts.guardian_signatures_buffer.set_inner(GuardianSignaturesBuffer {
            refund_recipient: ctx.accounts.payer.key(),
            guardian_signatures: new_guardian_signatures,
        });
    }
    // Done.
    Ok(())
}
