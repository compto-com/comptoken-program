import {
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    SYSVAR_SLOT_HASHES_PUBKEY,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction
} from "@solana/web3.js";

import {
    AuthorityType,
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    setAuthority,
    unpackMint,
} from '@solana/spl-token';

import {
    bs58,
    compto_program_id_pubkey,
    comptoken_mint_pubkey,
    global_data_account_pubkey,
    interest_bank_account_pubkey,
    me_keypair,
    testUser_keypair,
} from './common.js';

import {
    Instruction,
    createCreateUserDataAccountInstruction,
    createGetValidBlockhashesInstruction,
    createInitializeComptokenProgramInstruction,
    createTestInstruction
} from './instruction.js';

import base64 from "base64-js";

import { mintComptokens } from './comptoken_proof.js';

let testuser_pubkey = getAssociatedTokenAddressSync(comptoken_mint_pubkey, testUser_keypair.publicKey, false, TOKEN_2022_PROGRAM_ID);

console.log("me: " + me_keypair.publicKey);
console.log("testuser comptoken wallet: " + testuser_pubkey);
console.log("testuser: " + testUser_keypair.publicKey);
console.log("comptoken mint: " + comptoken_mint_pubkey);
console.log("compto program id: " + compto_program_id_pubkey);
console.log("global data account: " + global_data_account_pubkey);

let connection = new Connection('http://localhost:8899', 'recent');

(async () => {
    await airdrop(testUser_keypair.publicKey);
    await setMintAuthorityIfNeeded();
    await createGlobalDataAccount();
    await testMint();
    await createUserDataAccount();
    let current_block = (await getValidBlockHashes()).current_block;
    await mintComptokens(connection, testuser_pubkey, current_block);
    //await dailyDistributionEvent();
    //await getOwedComptokens();
})();


async function airdrop(pubkey) {
    let airdropSignature = await connection.requestAirdrop(pubkey, 3 * LAMPORTS_PER_SOL,);
    await connection.confirmTransaction({ signature: airdropSignature });
    console.log("Airdrop confirmed");
}

async function setMintAuthorityIfNeeded() {
    const info = await connection.getAccountInfo(comptoken_mint_pubkey, "confirmed");
    const unpackedMint = unpackMint(comptoken_mint_pubkey, info, TOKEN_2022_PROGRAM_ID);
    if (unpackedMint.mintAuthority.toString() == global_data_account_pubkey.toString()) {
        console.log("Mint Authority already set, skipping setAuthority Transaction");
    } else {
        console.log("Mint Authority not set, setting Authority");
        await setMintAuthority(unpackedMint.mintAuthority);
    }
}

async function setMintAuthority(current_mint_authority_pubkey) {
    let me_signer = { publicKey: me_keypair.publicKey, secretKey: me_keypair.secretKey }
    let new_mint_authority = global_data_account_pubkey;
    const res = await setAuthority(
        connection,
        me_signer,
        comptoken_mint_pubkey,
        current_mint_authority_pubkey,
        AuthorityType.MintTokens,
        new_mint_authority,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
    );
}

async function testMint() {

    let testMintTransaction = new Transaction();
    testMintTransaction.add(
        createTestInstruction(testUser_keypair.publicKey, testuser_pubkey, 2n),
    );
    let testMintResult = await sendAndConfirmTransaction(connection, testMintTransaction, [testUser_keypair, testUser_keypair]);
    console.log("testMint transaction confirmed", testMintResult);
}

async function createGlobalDataAccount() {
    let createGlobalDataAccountTransaction = new Transaction();
    createGlobalDataAccountTransaction
        .add(
            await createInitializeComptokenProgramInstruction(connection, testUser_keypair.publicKey),
        );
    let createGlobalDataAccountResult = await sendAndConfirmTransaction(connection, createGlobalDataAccountTransaction, [testUser_keypair, testUser_keypair]);
    console.log("createGlobalDataAccount transaction confirmed", createGlobalDataAccountResult);
}

async function createUserDataAccount() {
    let createUserDataAccountTransaction = new Transaction();
    createUserDataAccountTransaction.add(
        await createCreateUserDataAccountInstruction(connection, 88, testUser_keypair.publicKey, testUser_keypair.publicKey, testuser_pubkey),
    );
    let createUserDataAccountResult = await sendAndConfirmTransaction(connection, createUserDataAccountTransaction, [testUser_keypair]);
    console.log("createUserDataAccount transaction confirmed", createUserDataAccountResult);
}

async function dailyDistributionEvent() {
    let data = Buffer.alloc(1);
    data.writeUInt8(Instruction.DAILY_DISTRIBUTION_EVENT, 0);
    console.log("data: ", data);
    let keys = [
        // so the token program knows what kind of token
        { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: true },
        // stores information for/from the daily distribution
        { pubkey: global_data_account_pubkey, isSigner: false, isWritable: true },
        // comptoken token account used as bank for unpaid interest
        { pubkey: interest_bank_account_pubkey, isSigner: false, isWritable: true },
        // comptoken token account used as bank for unpaid Universal Basic Income
        { pubkey: ubi_bank_account_pubkey, isSigner: false, isWritable: true },
        // the token program that will mint the tokens when instructed by the mint authority
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        // program will pull a recent hash from slothashes sysvar if a new valid blockhash is needed.  
        { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
    ];
    let dailyDistributionEventTransaction = new Transaction();
    dailyDistributionEventTransaction.add(
        new TransactionInstruction({
            keys: keys,
            programId: compto_program_id_pubkey,
            data: data,
        }),
    );
    let dailyDistributionEventResult = await sendAndConfirmTransaction(connection, dailyDistributionEventTransaction, [testUser_keypair, testUser_keypair]);
    console.log("DailyDistributionEvent transaction confirmed", dailyDistributionEventResult);

}

async function getValidBlockHashes() {
    let getValidBlockhashesTransaction = new Transaction();
    getValidBlockhashesTransaction.add(
        await createGetValidBlockhashesInstruction()
    );
    let getValidBlockhashesResult = await sendAndConfirmTransaction(connection, getValidBlockhashesTransaction, [testUser_keypair, testUser_keypair]);
    console.log("getValidBlockhashes transaction confirmed", getValidBlockhashesResult);
    let result = await waitForTransactionConfirmation(getValidBlockhashesResult);
    let resultData = result.meta.returnData.data[0];
    let resultBytes = base64.toByteArray(resultData);
    let currentBlockB58 = bs58.encode(resultBytes.slice(0, 32));
    let announcedBlockB58 = bs58.encode(resultBytes.slice(32, 64));
    let validBlockHashes = { current_block: currentBlockB58, announced_block: announcedBlockB58, };
    console.log("Valid Block Hashes: ", validBlockHashes);
    return validBlockHashes;
}

async function getOwedComptokens() {
    let data = Buffer.alloc(1);
    data.writeUInt8(Instruction.GET_OWED_COMPTOKENS, 0);
    console.log("data: ", data);

    let user_data_account = PublicKey.findProgramAddressSync([testuser_pubkey.toBytes()], compto_program_id_pubkey)[0];

    let keys = [
        //  User's Data Account
        { pubkey: user_data_account, isSigner: false, isWritable: true },
        //  User's Comptoken Wallet
        { pubkey: testuser_pubkey, isSigner: false, isWritable: true },
        //  Comptoken Mint
        { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: false },
        //  Comptoken Global Data (also mint authority)
        { pubkey: global_data_account_pubkey, isSigner: false, isWritable: false },
        //  Comptoken Interest Bank 
        { pubkey: interest_bank_account_pubkey, isSigner: false, isWritable: true },
        //  Comptoken UBI Bank
        { pubkey: ubi_bank_account_pubkey, isSigner: false, isWritable: true },
        //  Token 2022 Program
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    let getValidBlockhashesTransaction = new Transaction();
    getValidBlockhashesTransaction.add(
        new TransactionInstruction({
            keys: keys,
            programId: compto_program_id_pubkey,
            data: data,
        }),
    );
    let getValidBlockhashesResult = await sendAndConfirmTransaction(connection, getValidBlockhashesTransaction, [testUser_keypair, testUser_keypair]);
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