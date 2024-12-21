import { ComptoPublicKeys, GlobalData } from "@compto/comptoken.js";
import { PublicKey, SYSVAR_SLOT_HASHES_PUBKEY, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { get_default_comptoken_token_account } from "./accounts.js";
import { bigintAsU64ToBytes } from "./utils.js";

/**
 * @param {PublicKey} user_wallet_address
 * @param {PublicKey} user_comptoken_token_account_address
 * @param {BigInt} amount
 * @param {ComptoPublicKeys} compto_public_keys
 * @returns {Promise<TransactionInstruction>}
 */
export async function createTestInstruction(user_wallet_address, user_comptoken_token_account_address, amount, compto_public_keys) {
    return new TransactionInstruction({
        programId: compto_public_keys.compto_program_id_pubkey,
        keys: [
            // communicates to the token program which mint (and therefore which mint authority)
            // to mint the tokens from
            { pubkey: compto_public_keys.comptoken_mint_pubkey, isSigner: false, isWritable: true },
            // the mint authority that will sign to mint the tokens
            { pubkey: compto_public_keys.global_data_account_pubkey, isSigner: false, isWritable: false },
            // the owner of the comptoken wallet
            { pubkey: user_wallet_address, isSigner: true, isWritable: false },
            // the address to receive the test tokens
            { pubkey: user_comptoken_token_account_address, isSigner: false, isWritable: true },
            // the token program that will mint the tokens when instructed by the mint authority
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ], data: Buffer.from([
            255, // Test Instruction, only exists on devnet
            ...bigintAsU64ToBytes(amount),
        ]),
    });
}

/**
 * 
 * @param {PublicKey} connection 
 * @param {PublicKey} payer
 * @param {ComptoPublicKeys} compto_public_keys 
 * @returns 
 */
export async function createInitializeComptokenProgramInstruction(connection, payer, compto_public_keys) {
    let lamports_global_data_account = await connection.getMinimumBalanceForRentExemption(new GlobalData().getSize());
    let bank_account_size = get_default_comptoken_token_account(1, PublicKey.default).data.getSize();
    console.log(`bank_account_size: ${bank_account_size}`);
    let lamports_bank_account = await connection.getMinimumBalanceForRentExemption(bank_account_size);
    return new TransactionInstruction({
        programId: compto_public_keys.compto_program_id_pubkey,
        keys: [
            //      [s, w] Payer (probably COMPTO's account)
            { pubkey: payer, isSigner: true, isWritable: true },
            //      [] Comptoken Mint
            { pubkey: compto_public_keys.comptoken_mint_pubkey, isSigner: false, isWritable: false },
            //      [w] Global Data Account (also mint authority)
            { pubkey: compto_public_keys.global_data_account_pubkey, isSigner: false, isWritable: true },
            //      [w] Comptoken Interest Bank
            { pubkey: compto_public_keys.interest_bank_account_pubkey, isSigner: false, isWritable: true },
            //      [w] Comptoken Verified Human UBI Bank
            { pubkey: compto_public_keys.verified_human_ubi_bank_account_pubkey, isSigner: false, isWritable: true },
            //      [w] Comptoken Future UBI Bank
            { pubkey: compto_public_keys.future_ubi_bank_account_pubkey, isSigner: false, isWritable: true },
            //      [] Transfer Hook Program
            { pubkey: compto_public_keys.compto_transfer_hook_id_pubkey, isSigner: false, isWritable: false },
            //      [w] Extra Account Metas Account
            { pubkey: compto_public_keys.compto_extra_account_metas_account_pubkey, isSigner: false, isWritable: true },
            //      [] Solana Program
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            //      [] Solana Token 2022 Program
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            //      [] Solana SlotHashes Sysvar
            { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
        ], data: Buffer.from([
            2, // Initialize Comptoken Program
            ...bigintAsU64ToBytes(lamports_global_data_account),
            ...bigintAsU64ToBytes(lamports_bank_account), // Interest Bank
            ...bigintAsU64ToBytes(lamports_bank_account), // Verified Human UBI Bank
            ...bigintAsU64ToBytes(lamports_bank_account), // Future UBI Bank
        ]),
    });
}


