import {
    ComptokenProof,
    createCreateUserDataAccountInstruction,
    createDailyDistributionEventInstruction,
    createGetOwedComptokensInstruction,
    createGetValidBlockhashesInstruction,
    createProofSubmissionInstruction,
    devnet_compto_public_keys,
    getValidBlockhashesFromTransactionResponse,
} from "@compto/comptoken.js";
import {
    AuthorityType,
    TOKEN_2022_PROGRAM_ID,
    createAssociatedTokenAccount,
    getAssociatedTokenAddressSync,
    setAuthority,
} from '@solana/spl-token';
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";

import { MintAccount } from "./accounts.js";
import {
    me_keypair,
    compto_public_keys as test_user_compto_public_keys,
} from './common.js';
import {
    createInitializeComptokenProgramInstruction,
    createTestInstruction,
} from './instruction.js';


const compto_public_keys = devnet_compto_public_keys;
compto_public_keys.test_account = test_user_compto_public_keys.test_account;

let testuser_pubkey = getAssociatedTokenAddressSync(compto_public_keys.comptoken_mint_pubkey, compto_public_keys.test_account.publicKey, false, TOKEN_2022_PROGRAM_ID);

console.log("me: " + me_keypair.publicKey);
console.log("testuser comptoken wallet: " + testuser_pubkey);
console.log("testuser: " + compto_public_keys.test_account.publicKey);
console.log("comptoken mint: " + compto_public_keys.comptoken_mint_pubkey);
console.log("compto program id: " + compto_public_keys.compto_program_id_pubkey);
console.log("global data account: " + compto_public_keys.global_data_account_pubkey);

let connection = new Connection('https://api.devnet.solana.com', 'confirmed');

(async () => {
    //await airdrop(compto_public_keys.test_account.publicKey);
    //await setMintAuthorityIfNeeded();
    //await createGlobalDataAccount();
    //await testMint();
    //await createUserComptokenTokenAccount();
    //await createUserDataAccount();
    let current_block = (await getValidBlockHashes()).validBlockhash;
    await mintComptokens(connection, compto_public_keys.test_account, testuser_pubkey, current_block);
    //await dailyDistributionEvent();
    //await getOwedComptokens();
})();


async function airdrop(pubkey) {
    let airdropSignature = await connection.requestAirdrop(pubkey, 3 * LAMPORTS_PER_SOL,);
    await connection.confirmTransaction({ signature: airdropSignature });
    console.log("Airdrop confirmed");
}

async function setMintAuthorityIfNeeded() {
    const info = await connection.getAccountInfo(compto_public_keys.comptoken_mint_pubkey, "confirmed");
    const mint = MintAccount.fromAccountInfoBytes(compto_public_keys.comptoken_mint_pubkey, info);
    if (mint.data.mintAuthority.toString() == compto_public_keys.global_data_account_pubkey.toString()) {
        console.log("Mint Authority already set, skipping setAuthority Transaction");
    } else {
        console.log("Mint Authority not set, setting Authority");
        await setMintAuthority(mint.data.mintAuthority);
    }
}

async function setMintAuthority(current_mint_authority_pubkey) {
    let me_signer = { publicKey: me_keypair.publicKey, secretKey: me_keypair.secretKey }
    let new_mint_authority = compto_public_keys.global_data_account_pubkey;
    const res = await setAuthority(
        connection,
        me_signer,
        compto_public_keys.comptoken_mint_pubkey,
        current_mint_authority_pubkey,
        AuthorityType.MintTokens,
        new_mint_authority,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
    );
}

async function createGlobalDataAccount() {
    let createGlobalDataAccountTransaction = new Transaction();
    createGlobalDataAccountTransaction
        .add(
            await createInitializeComptokenProgramInstruction(connection, compto_public_keys.test_account.publicKey, compto_public_keys),
        );
    let createGlobalDataAccountResult = await sendAndConfirmTransaction(connection, createGlobalDataAccountTransaction, [compto_public_keys.test_account]);
    console.log("createGlobalDataAccount transaction confirmed", createGlobalDataAccountResult);
}

async function testMint() {
    let testMintTransaction = new Transaction();
    testMintTransaction.add(
        await createTestInstruction(compto_public_keys.test_account.publicKey, testuser_pubkey, 2n, compto_public_keys),
    );
    let testMintResult = await sendAndConfirmTransaction(connection, testMintTransaction, [compto_public_keys.test_account]);
    console.log("testMint transaction confirmed", testMintResult);
}

async function createUserComptokenTokenAccount() {
    let createTokenAccountResult = await createAssociatedTokenAccount(
        connection,
        compto_public_keys.test_account,
        compto_public_keys.comptoken_mint_pubkey,
        compto_public_keys.test_account.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID
    );
    console.log("createTokenAccount transaction confirmed", createTokenAccountResult);
}

async function createUserDataAccount() {
    let createUserDataAccountTransaction = new Transaction();
    createUserDataAccountTransaction.add(
        await createCreateUserDataAccountInstruction(
            connection,
            5,
            compto_public_keys.test_account.publicKey,
            compto_public_keys.test_account.publicKey,
            testuser_pubkey,
            compto_public_keys,
        ),
    );
    let createUserDataAccountResult = await sendAndConfirmTransaction(connection, createUserDataAccountTransaction, [compto_public_keys.test_account]);
    console.log("createUserDataAccount transaction confirmed", createUserDataAccountResult);
}

async function getValidBlockHashes() {
    let getValidBlockhashesTransaction = new Transaction();
    getValidBlockhashesTransaction.add(
        await createGetValidBlockhashesInstruction(compto_public_keys),
    );
    let getValidBlockhashesResult = await sendAndConfirmTransaction(connection, getValidBlockhashesTransaction, [compto_public_keys.test_account]);
    console.log("getValidBlockhashes transaction confirmed", getValidBlockhashesResult);
    let result = await waitForTransactionConfirmation(getValidBlockhashesResult);
    let validBlockHashes = getValidBlockhashesFromTransactionResponse(result);
    console.log("Valid Block Hashes: ", validBlockHashes);
    return validBlockHashes;
}

/**
 * @param {Connection} connection 
 * @param {Keypair} user_solana_wallet_keypair 
 * @param {PublicKey} user_comptoken_token_account_address 
 * @param {Uint8Array} current_block 
 */
async function mintComptokens(connection, user_solana_wallet_keypair, user_comptoken_token_account_address, current_block) {
    console.log("Minting Comptokens");
    const proof = ComptokenProof.mine({
        pubkey: user_comptoken_token_account_address,
        recentBlockHash: current_block,
        extraData: Uint8Array.from({ length: 32 }, () => 0),
        nonce: 0,
        version: 0,
        timestamp: (Date.now() / 1000) | 0,
    });
    let mintComptokensTransaction = new Transaction();
    mintComptokensTransaction.add(
        await createProofSubmissionInstruction(
            proof,
            user_solana_wallet_keypair.publicKey,
            user_comptoken_token_account_address,
            compto_public_keys
        ),
    );
    let mintComptokensResult = await sendAndConfirmTransaction(connection, mintComptokensTransaction, [user_solana_wallet_keypair]);
    console.log("MintComptokens transaction confirmed", mintComptokensResult);
}

async function dailyDistributionEvent() {
    let dailyDistributionEventTransaction = new Transaction();
    dailyDistributionEventTransaction.add(
        await createDailyDistributionEventInstruction(compto_public_keys),
    );
    let dailyDistributionEventResult = await sendAndConfirmTransaction(connection, dailyDistributionEventTransaction, [compto_public_keys.test_account]);
    console.log("DailyDistributionEvent transaction confirmed", dailyDistributionEventResult);
}

async function getOwedComptokens() {
    let getValidBlockhashesTransaction = new Transaction();
    getValidBlockhashesTransaction.add(
        await createGetOwedComptokensInstruction(compto_public_keys.test_account.publicKey, testuser_pubkey, compto_public_keys),
    );
    let getValidBlockhashesResult = await sendAndConfirmTransaction(connection, getValidBlockhashesTransaction, [compto_public_keys.test_account]);
    console.log("getOwedComptokens transaction confirmed", getValidBlockhashesResult);
}

async function waitForTransactionConfirmation(signature) {
    let attempts = 0;
    let max_attempts = 10;
    while (attempts++ < max_attempts) {
        let result = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
        if (result !== null) {
            return result;
        }
    }
    throw new Error('Transaction not confirmed after ' + max_attempts + ' attempts');
}