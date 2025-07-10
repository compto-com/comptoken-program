import { UserData, createGrowUserDataAccountInstruction } from "@compto/comptoken.js";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_global_data,
    get_default_user_data_account,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_public_keys } from "../common.js";
import { run_test, setup_test } from "../generic_test.js";

/**
 * @import { Commitment } from "@solana/web3.js"
 */

async function test_failShrinkUserDataAccount() {
    const user = Keypair.generate();

    const user_comptoken_wallet = get_default_comptoken_token_account(PublicKey.unique(), user.publicKey);
    const user_data_pda = PublicKey.findProgramAddressSync([user_comptoken_wallet.address.toBytes()], compto_public_keys.compto_program_id_pubkey)[0];
    const user_data_account = get_default_user_data_account(user_data_pda);
    const accounts = [get_default_comptoken_mint(), get_default_global_data(), user_comptoken_wallet, user_data_account];

    let context = await setup_test(accounts);
    let connection = {
        /**
         * @param {bigint}     dataLength
         * @param {Commitment} _commitment
         */
        async getMinimumBalanceForRentExemption(dataLength, _commitment) {
            let rent = await context.banksClient.getRent();
            return rent.minimumBalance(BigInt(dataLength));
        }
    }

    let new_user_data_size = BigInt(UserData.MIN_SIZE);
    let instructions = [
        await createGrowUserDataAccountInstruction(
            /* @ts-ignore */ // connection has the important funtions
            connection,
            new_user_data_size,
            context.payer.publicKey,
            user.publicKey,
            user_comptoken_wallet.address,
            compto_public_keys,
        ),
    ];

    context = await run_test("failShrinkUserDataAccount", context, instructions, [context.payer, user], true, async (context, result) => {
        Assert.assertNotNull(result.result, "program should fail");
        Assert.assert(
            result.meta?.logMessages.some((msg, i) => msg.includes("assertion failed: user_data_account.data_len() < new_size")) ?? false,
            "program should have failed b/c it wouldn't shrink"
        );
    });
}

(async () => { await test_failShrinkUserDataAccount(); })();
