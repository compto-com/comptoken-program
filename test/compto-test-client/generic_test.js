import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BanksTransactionResultWithMeta, Clock, ProgramTestContext, start } from "solana-bankrun";

import { Account } from "./accounts.js";
import { Assert } from "./assert.js";
import { compto_program_id_pubkey, compto_transfer_hook_id_pubkey, DEFAULT_START_TIME } from "./common.js";
import { debug, log, print } from "./parse_args.js";

/**
 * @param {string} name 
 * @param {ProgramTestContext} context
 * @param {TransactionInstruction[]} instructions
 * @param {Keypair[]} signers
 * @param {boolean} should_fail
 * @param {boolean} args
 * @param {(ProgramTestContext, BanksTransactionResultWithMeta) => null} assert_fn 
 * @returns {[ProgramTestContext, BanksTransactionResultWithMeta]}
 */
export async function run_test(name, context, instructions, signers, should_fail, assert_fn) {
    print("test " + name, "utf8");
    debug(context);
    debug(instructions);
    debug(signers);

    const client = context.banksClient;
    const payer = context.payer;

    const tx = new Transaction();
    [tx.recentBlockhash,] = await client.getLatestBlockhash();
    tx.add(...instructions);
    tx.feePayer = payer.publicKey;
    tx.sign(payer, ...signers);

    const result = await client.tryProcessTransaction(tx);

    debug("result: %s", result.result);
    if (result.meta !== null) {
        log("logMessages: %s", result.meta.logMessages);
        debug("computeUnitsConsumed: %d", result.meta.computeUnitsConsumed);
        debug("returnData: %s", result.meta.returnData);
    }

    debug("should_fail: %s", should_fail);
    if (should_fail) {
        Assert.assertNotNull(result.result, "transaction should have failed");
    } else {
        Assert.assert(result.result === null, "transaction should have succeeded");
    }


    await assert_fn(context, result);

    print("test %s passed", name);
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
