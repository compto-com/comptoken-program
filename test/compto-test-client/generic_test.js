import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BanksTransactionResultWithMeta, Clock, ProgramTestContext, start } from "solana-bankrun";

import { Account } from "./accounts.js";
import { Assert } from "./assert.js";
import { compto_program_id_pubkey, compto_transfer_hook_id_pubkey, DEFAULT_START_TIME } from "./common.js";

/**
 * @param {string} name 
 * @param {ProgramTestContext} context
 * @param {TransactionInstruction[]} instruction
 * @param {Keypair[]} signers
 * @param {(ProgramTestContext, BanksTransactionResultWithMeta) => null} assert_fn 
 * @returns {[ProgramTestContext, BanksTransactionResultWithMeta]}
 */
export async function run_test(name, context, instructions, signers, assert_fn) {
    console.log("test " + name)
    console.log(context);
    console.log(instructions);
    console.log(signers);

    const client = context.banksClient;
    const payer = context.payer;

    const tx = new Transaction();
    [tx.recentBlockhash,] = await client.getLatestBlockhash();
    tx.add(...instructions);
    tx.feePayer = payer.publicKey;
    tx.sign(payer, ...signers);

    const result = await client.tryProcessTransaction(tx);

    console.log("result: %s", result.result);
    if (result.meta !== null) {
        console.log("logMessages: %s", result.meta.logMessages);
        console.log("computeUnitsConsumed: %d", result.meta.computeUnitsConsumed);
        console.log("returnData: %s", result.meta.returnData);
    }


    await assert_fn(context, result);

    console.log("test passed");
    return [context, result];
}

/**
 * @param {Account[]} existing_accounts 
 * @param {Clock} clock
 * @returns {ProgramTestContext}
 */
export async function setup_test(existing_accounts, clock = new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME)) {
    let context = await start(
        [
            { name: "comptoken", programId: compto_program_id_pubkey },
            { name: "comptoken_transfer_hook", programId: compto_transfer_hook_id_pubkey },
        ],
        existing_accounts.map((account, i) => account.toAddedAccount()),
    );
    context.setClock(clock);

    return context;
}

/**
 * @param {ProgramTestContext} context 
 * @param {PublicKey} account_address 
 * @param {typeof Account} account_type
 * @returns 
 */
export async function get_account(context, account_address, account_type) {
    let account = await context.banksClient.getAccount(account_address);
    Assert.assertNotNull(account);
    return account_type.fromAccountInfoBytes(account_address, account);
}