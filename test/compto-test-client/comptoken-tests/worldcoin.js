import { devnet_compto_public_keys as compto_public_keys, createGetOwedComptokensInstruction, createVerifyHumanInstruction, } from "@compto/comptoken.js";
import { getSimulationComputeUnits } from "@solana-developers/helpers";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, } from "@solana/spl-token";
import { AddressLookupTableAccount, clusterApiUrl, ComputeBudgetProgram, Connection, sendAndConfirmTransaction, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { compto_public_keys as test_user_compto_public_keys } from "../common.js";
import { zip } from "../utils.js";

/**
 * 
 * @param {Connection} connection 
 * @param {TransactionInstruction[]} transaction 
 * @param {import("@solana/web3.js").Signer} signer 
 * @param {AddressLookupTableAccount[]} lookupTables 
 * @returns 
 */
async function buildOptimalTransaction(
    connection,
    instructions,
    signer,
    lookupTables,
) {
    const [units, recentBlockhash] = await Promise.all([
        getSimulationComputeUnits(
            connection,
            instructions,
            signer.publicKey,
            lookupTables,
        ),
        connection.getLatestBlockhash(),
    ]);

    if (units) {
        // probably should add some margin of error to units
        instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: units * 1.1 }));
    }
    return {
        transaction: new VersionedTransaction(
            new TransactionMessage({
                instructions,
                recentBlockhash: recentBlockhash.blockhash,
                payerKey: signer.publicKey,
            }).compileToV0Message(lookupTables),
        ),
        recentBlockhash,
    };
}

async function getOwedComptokens() {
    const connection = new Connection(clusterApiUrl("devnet"), 'confirmed');
    const test_user_comptoken_account = getAssociatedTokenAddressSync(compto_public_keys.comptoken_mint_pubkey, test_user_compto_public_keys.test_account.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const instructions = [await createGetOwedComptokensInstruction(test_user_compto_public_keys.test_account.publicKey, test_user_comptoken_account, compto_public_keys)];

    //let { transaction, recentBlockhash } = await buildOptimalTransaction(connection, instructions, test_user_compto_public_keys.test_account, []);
    //transaction.sign([test_user_compto_public_keys.test_account]);
    let transaction = new Transaction();
    transaction.add(...instructions);

    let confirmation = await sendAndConfirmTransaction(connection, transaction, [test_user_compto_public_keys.test_account]);
    console.log(`Transaction confirmed, ${confirmation}`);
}

async function testVerifyHuman() {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

    const nullifier_hash = Buffer.from("0302f0dd33b9c4f5a38af8bf81b5ed143b3934c8e37194f2516cb56e34ca6678", "hex");
    const root_hash = Buffer.from("01df1992cc8c17d0e2b2c2763b49f0fae836a2e967a24c8fa602ce3c17b7dbf4", "hex");
    const proof = Buffer.from(
        "2416d3ce0edf975f5732bc03110124364837fb280669ff3f05472ac619d1f3e4" +
        "217cf1cb1b885a1385784d83d470c0b60ae3ea95ccfd043542394933e4b6012b" +
        "22f417e3cde733f286ca4dc0839bf1abb7e409dc43db6714e089058724727660" +
        "1544a0973228f5b4b07a3aadc8dbdb1c25fc0e4bad6e7e566cbc3a4e46b45f2e" +
        "2ead717433b1362c7afb7545d5c0b34763d587d952ebe90726b89fc28e5ce054" +
        "3019dd7c1d88ed05e8ab14c061353dc362d4bf50ec82d358f1ef98056930b020" +
        "00c402054b1f2f52a29420c9ebde032fd0362e2fe8e1253fc5cc7e88fe3eaa0a" +
        "16a0f661d52882112db2efd528ee1d684454550bd0c8f32996e33ce90c9cdf4f",
        "hex"
    );

    const test_user_comptoken_account = getAssociatedTokenAddressSync(
        compto_public_keys.comptoken_mint_pubkey,
        test_user_compto_public_keys.test_account.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
    );

    let instruction = await createVerifyHumanInstruction(
        connection,
        test_user_compto_public_keys.test_account.publicKey,
        test_user_compto_public_keys.test_account.publicKey,
        test_user_comptoken_account,
        root_hash,
        nullifier_hash,
        proof,
        compto_public_keys,
    );

    const keys = [
        "[s, w] Payer Account",
        "[] Comptoken Program",
        "[] Comptoken Mint",
        "[w] Comptoken Global Data",
        "[w] Comptoken Future UBI Bank",
        "[] Comptoken Future UBI Bank Data PDA",
        "[s] User Solana Wallet",
        "[w] User's Comptoken Token Account",
        "[w] User's Data",
        "[] Transfer Hook Program",
        "[] Extra Account Metas Account",
        "[] World ID Program",
        "[] World ID Root",
        "[] World ID Latest Root",
        "[] World ID Config",
        "[w] World ID Nullifier",
        "[] Solana Token 2022 Program",
    ];

    for (const [key, value] of zip(keys, instruction.keys)) {
        console.log(`${key}: ${value.pubkey.toString()}`);
    }

    console.log(`root_hash: ${root_hash.toString('hex')}`);
    console.log(`nullifier_hash: ${nullifier_hash.toString('hex')}`);
    console.log(`proof: ${proof.toString('hex')}`);

    //let transaction = buildOptimalTransaction(connection, [instruction], test_user_compto_public_keys.test_account, []);
    let transaction = new Transaction();
    transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 * 2 }),
        instruction,
    );

    let confirmation = await sendAndConfirmTransaction(connection, transaction, [test_user_compto_public_keys.test_account]);
    console.log(`Transaction confirmed, ${confirmation}`);
}

await getOwedComptokens();
await testVerifyHuman();