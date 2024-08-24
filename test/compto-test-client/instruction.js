import { PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { ProgramTestContext } from "solana-bankrun";

import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { COMPTOKEN_WALLET_SIZE, GlobalData } from "./accounts.js";
import {
    compto_extra_account_metas_account_pubkey,
    compto_program_id_pubkey,
    compto_transfer_hook_id_pubkey,
    comptoken_mint_pubkey,
    future_ubi_bank_account_pubkey,
    global_data_account_pubkey,
    interest_bank_account_pubkey,
    verified_human_ubi_bank_account_pubkey,
} from "./common.js";
import { ComptokenProof } from "./comptoken_proof.js";
import { bigintAsU64ToBytes } from "./utils.js";


export const Instruction = {
    PROOF_SUBMISSION: 1,
    INITIALIZE_COMPTOKEN_PROGRAM: 2,
    CREATE_USER_DATA_ACCOUNT: 3,
    DAILY_DISTRIBUTION_EVENT: 4,
    GET_VALID_BLOCKHASHES: 5,
    GET_OWED_COMPTOKENS: 6,
    GROW_USER_DATA_ACCOUNT: 7,
    VERIFY_HUMAN: 8,
    TEST: 255,
};

/**
 * @param {PublicKey} user_wallet_address
 * @param {PublicKey} user_comptoken_token_account_address
 * @param {BigInt} amount
 * @returns {TransactionInstruction}
 */
export function createTestInstruction(user_wallet_address, user_comptoken_token_account_address, amount) {
    return new TransactionInstruction({
        programId: compto_program_id_pubkey,
        keys: [
            // communicates to the token program which mint (and therefore which mint authority)
            // to mint the tokens from
            { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: true },
            // the mint authority that will sign to mint the tokens
            { pubkey: global_data_account_pubkey, isSigner: false, isWritable: false },
            // the owner of the comptoken wallet
            { pubkey: user_wallet_address, isSigner: true, isWritable: false },
            // the address to receive the test tokens
            { pubkey: user_comptoken_token_account_address, isSigner: false, isWritable: true },
            // the token program that will mint the tokens when instructed by the mint authority
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ], data: Buffer.from([Instruction.TEST, ...bigintAsU64ToBytes(amount)]),
    });
}

/**
 * @param {ComptokenProof} comptoken_proof
 * @param {PublicKey} user_wallet_address
 * @param {PublicKey} user_comptoken_token_account_address
 * @param {PublicKey} destination_data_account_address
 * @returns {TransactionInstruction}
 */
export async function createProofSubmissionInstruction(comptoken_proof, user_wallet_address, user_comptoken_token_account_address) {
    const user_data_account_address = PublicKey.findProgramAddressSync([user_comptoken_token_account_address.toBytes()], compto_program_id_pubkey)[0];
    return new TransactionInstruction({
        programId: compto_program_id_pubkey,
        keys: [
            // will mint some comptokens
            { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: true },
            // stores the current valid blockhashes
            { pubkey: global_data_account_pubkey, isSigner: false, isWritable: false },
            // the owner of the comptoken wallet
            { pubkey: user_wallet_address, isSigner: true, isWritable: false },
            // will store minted comptoken
            { pubkey: user_comptoken_token_account_address, isSigner: false, isWritable: true },
            // stores the proof to prevent duplicate submissions
            { pubkey: user_data_account_address, isSigner: false, isWritable: true },
            // for the actual minting
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ], data: Buffer.from([
            Instruction.PROOF_SUBMISSION,
            ...comptoken_proof.serializeData(),
        ]),
    });
}

/**
 * @param {ProgramTestContext} context 
 * @returns {TransactionInstruction}
 */
export async function createInitializeComptokenProgramInstruction(context) {
    const rent = await context.banksClient.getRent();
    return new TransactionInstruction({
        programId: compto_program_id_pubkey,
        keys: [
            // the payer of the rent for the account
            { pubkey: context.payer.publicKey, isSigner: true, isWritable: true },
            // the comptoken mint account
            { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: false },
            // the address of the global data account to be created
            { pubkey: global_data_account_pubkey, isSigner: false, isWritable: true },
            // the address of the interest bank account to be created
            { pubkey: interest_bank_account_pubkey, isSigner: false, isWritable: true },
            // the address of the verified human ubi bank account to be created
            { pubkey: verified_human_ubi_bank_account_pubkey, isSigner: false, isWritable: true },
            // the address of the future ubi bank account to be created
            { pubkey: future_ubi_bank_account_pubkey, isSigner: false, isWritable: true },
            // compto transfer hook program also needs to be initialized
            { pubkey: compto_transfer_hook_id_pubkey, isSigner: false, isWritable: false },
            // the transfer hook program initialization sets the extra account metas in this account
            { pubkey: compto_extra_account_metas_account_pubkey, isSigner: false, isWritable: true },
            // needed because compto program interacts with the system program to create the account
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            // the token program that will mint the tokens when instructed by the mint authority
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            // program will pull a recent hash from slothashes sysvar if a new valid blockhash is needed.
            { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([
            Instruction.INITIALIZE_COMPTOKEN_PROGRAM,
            ...bigintAsU64ToBytes(await rent.minimumBalance(BigInt(GlobalData.LAYOUT.span))),
            ...bigintAsU64ToBytes(await rent.minimumBalance(BigInt(COMPTOKEN_WALLET_SIZE))),
            ...bigintAsU64ToBytes(await rent.minimumBalance(BigInt(COMPTOKEN_WALLET_SIZE))),
            ...bigintAsU64ToBytes(await rent.minimumBalance(BigInt(COMPTOKEN_WALLET_SIZE))),
        ]),
    });
}

/**
 * @param {ProgramTestContext} context
 * @param {BigInt} user_data_size
 * @param {PublicKey} payer_address
 * @param {PublicKey} user_wallet_address
 * @param {PublicKey} user_comptoken_token_account_address
 * @returns {TransactionInstruction}
 */
export async function createCreateUserDataAccountInstruction(context, user_data_size, payer_address, user_wallet_address, user_comptoken_token_account_address) {
    const rent = await context.banksClient.getRent();
    const user_data_account_address = PublicKey.findProgramAddressSync([user_comptoken_token_account_address.toBytes()], compto_program_id_pubkey)[0];
    return new TransactionInstruction({
        programId: compto_program_id_pubkey,
        keys: [
            // the payer of the rent for the account
            { pubkey: payer_address, isSigner: true, isWritable: true },
            // the owner of the comptoken wallet
            { pubkey: user_wallet_address, isSigner: true, isWritable: false },
            // the payers comptoken wallet (comptoken token acct)
            { pubkey: user_comptoken_token_account_address, isSigner: false, isWritable: false },
            // the data account tied to the comptoken wallet
            { pubkey: user_data_account_address, isSigner: false, isWritable: true },
            // system account is used to create the account
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([
            Instruction.CREATE_USER_DATA_ACCOUNT,
            ...bigintAsU64ToBytes(await rent.minimumBalance(user_data_size)),
            ...bigintAsU64ToBytes(user_data_size),
        ]),
    });
}

/**
 * @returns {TransactionInstruction}
 */
export async function createDailyDistributionEventInstruction() {
    return new TransactionInstruction({
        programId: compto_program_id_pubkey,
        keys: [
            // so the token program knows what kind of token
            { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: true },
            // stores information for/from the daily distribution
            { pubkey: global_data_account_pubkey, isSigner: false, isWritable: true },
            // comptoken token account used as bank for unpaid interest
            { pubkey: interest_bank_account_pubkey, isSigner: false, isWritable: true },
            // comptoken token account used as bank for unpaid Universal Basic Income to verified humans
            { pubkey: verified_human_ubi_bank_account_pubkey, isSigner: false, isWritable: true },
            // comptoken token account used as bank for future ubi payouts
            { pubkey: future_ubi_bank_account_pubkey, isSigner: false, isWritable: true },
            // the token program that will mint the tokens when instructed by the mint authority
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            // program will pull a recent hash from slothashes sysvar if a new valid blockhash is needed.  
            { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
            // comptoken token account used as bank for future ubi payouts
            { pubkey: future_ubi_bank_account_pubkey, isSigner: false, isWritable: true },
        ],
        data: Buffer.from([Instruction.DAILY_DISTRIBUTION_EVENT]),
    });
}

/**
 * @returns {TransactionInstruction}
 */
export async function createGetValidBlockhashesInstruction() {
    return new TransactionInstruction({
        programId: compto_program_id_pubkey,
        keys: [
            // stores valid blockhashes, but may be out of date
            { pubkey: global_data_account_pubkey, isSigner: false, isWritable: true },
            // program will pull a recent hash from slothashes sysvar if a new valid blockhash is needed.  
            { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([Instruction.GET_VALID_BLOCKHASHES]),
    });
}

/**
 * @param {PublicKey} user_wallet_address
 * @param {PublicKey} user_comptoken_token_account_address
 * @returns {TransactionInstruction}
 */
export async function createGetOwedComptokensInstruction(user_wallet_address, user_comptoken_token_account_address) {
    const user_data_account_address = PublicKey.findProgramAddressSync([user_comptoken_token_account_address.toBytes()], compto_program_id_pubkey)[0];
    return new TransactionInstruction({
        programId: compto_program_id_pubkey,
        keys: [
            //  needed by the transfer hook program
            { pubkey: compto_program_id_pubkey, isSigner: false, isWritable: false },
            //  Comptoken Mint lets the token program know what kind of token to move
            { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: false },
            //  Comptoken Global Data (also mint authority) stores interest data
            { pubkey: global_data_account_pubkey, isSigner: false, isWritable: false },
            //  Comptoken Interest Bank stores comptokens owed for interest
            { pubkey: interest_bank_account_pubkey, isSigner: false, isWritable: true },
            //  Comptoken UBI Bank stores comptokens owed for UBI
            { pubkey: verified_human_ubi_bank_account_pubkey, isSigner: false, isWritable: true },
            //  needed by the transfer hook program (doesn't really exist)
            { pubkey: PublicKey.findProgramAddressSync([interest_bank_account_pubkey.toBytes()], compto_program_id_pubkey)[0], isSigner: false, isWritable: false },
            //  needed by the transfer hook program (doesn't really exist)
            { pubkey: PublicKey.findProgramAddressSync([verified_human_ubi_bank_account_pubkey.toBytes()], compto_program_id_pubkey)[0], isSigner: false, isWritable: false },
            // the owner of the Comptoken Token Account
            { pubkey: user_wallet_address, isSigner: true, isWritable: false },
            //  User's Comptoken Token Account is the account to send the comptokens to
            { pubkey: user_comptoken_token_account_address, isSigner: false, isWritable: true },
            //  User's Data Account stores how long it's been since they received owed comptokens
            { pubkey: user_data_account_address, isSigner: false, isWritable: true },
            //  compto transfer hook program is called by the transfer that gives the owed comptokens
            { pubkey: compto_transfer_hook_id_pubkey, isSigner: false, isWritable: false },
            //  stores account metas to add to transfer instructions
            { pubkey: compto_extra_account_metas_account_pubkey, isSigner: false, isWritable: false },
            //  Token 2022 Program moves the tokens
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([Instruction.GET_OWED_COMPTOKENS]),
    })
}

/**
 * @param {ProgramTestContext} context 
 * @param {BigInt} new_user_data_size 
 * @param {PublicKey} payer_address 
 * @param {PublicKey} user_wallet_address 
 * @param {PublicKey} user_comptoken_wallet_address 
 * @returns {TransactionInstruction}
 */
export async function createGrowUserDataAccountInstruction(context, new_user_data_size, payer_address, user_wallet_address, user_comptoken_wallet_address) {
    const rent = await context.banksClient.getRent();
    const user_data_account_address = PublicKey.findProgramAddressSync([user_comptoken_wallet_address.toBytes()], compto_program_id_pubkey)[0];
    return new TransactionInstruction({
        programId: compto_program_id_pubkey,
        keys: [
            // the payer of the rent for the account
            { pubkey: payer_address, isSigner: true, isWritable: true },
            // the owner of the comptoken wallet
            { pubkey: user_wallet_address, isSigner: true, isWritable: false },
            // the payers comptoken wallet (comptoken token acct)
            { pubkey: user_comptoken_wallet_address, isSigner: false, isWritable: false },
            // the data account tied to the comptoken wallet
            { pubkey: user_data_account_address, isSigner: false, isWritable: true },
            // system account is used to create the account
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([
            Instruction.GROW_USER_DATA_ACCOUNT,
            ...bigintAsU64ToBytes(await rent.minimumBalance(new_user_data_size)),
            ...bigintAsU64ToBytes(new_user_data_size),
        ]),
    })
}

/**
 * @param {PublicKey} user_wallet_address
 * @param {PublicKey} user_comptoken_token_account_address
 * @returns {TransactionInstruction}
 */
export async function createVerifyHumanInstruction(user_wallet_address, user_comptoken_token_account_address) {
    const user_data_account_address = PublicKey.findProgramAddressSync([user_comptoken_token_account_address.toBytes()], compto_program_id_pubkey)[0];
    return new TransactionInstruction({
        programId: compto_program_id_pubkey,
        keys: [
            //  needed by the transfer hook program
            { pubkey: compto_program_id_pubkey, isSigner: false, isWritable: false },
            //  Comptoken Mint lets the token program know what kind of token to move
            { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: false },
            //  Comptoken Global Data (also mint authority) stores interest data
            { pubkey: global_data_account_pubkey, isSigner: false, isWritable: true },
            //  Comptoken Future UBI Bank stores comptokens owed to future verified humans
            { pubkey: future_ubi_bank_account_pubkey, isSigner: false, isWritable: true },
            //  needed by the transfer hook program (doesn't really exist)
            { pubkey: PublicKey.findProgramAddressSync([future_ubi_bank_account_pubkey.toBytes()], compto_program_id_pubkey)[0], isSigner: false, isWritable: false },
            // the owner of the Comptoken Token Account
            { pubkey: user_wallet_address, isSigner: true, isWritable: false },
            //  User's Comptoken Token Account is the account to send the comptokens to
            { pubkey: user_comptoken_token_account_address, isSigner: false, isWritable: true },
            //  User's Data Account stores how long it's been since they received owed comptokens
            { pubkey: user_data_account_address, isSigner: false, isWritable: true },
            //  compto transfer hook program is called by the transfer that gives the owed comptokens
            { pubkey: compto_transfer_hook_id_pubkey, isSigner: false, isWritable: false },
            //  stores account metas to add to transfer instructions
            { pubkey: compto_extra_account_metas_account_pubkey, isSigner: false, isWritable: false },
            //  Token 2022 Program moves the tokens
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([Instruction.VERIFY_HUMAN]),
    });
}