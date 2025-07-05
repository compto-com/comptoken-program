import { createResizeUserDataAccountInstruction, UserData } from "@compto/comptoken.js";
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

async function test_resizeUserDataInstruction_grow() {
    const user = Keypair.generate();

    const user_comptoken_wallet = get_default_comptoken_token_account(PublicKey.unique(), user.publicKey);
    const user_data_pda = PublicKey.findProgramAddressSync([user_comptoken_wallet.address.toBytes()], compto_public_keys.compto_program_id_pubkey)[0];
    const user_data_account = get_default_user_data_account(user_data_pda);

    const existing_accounts = [
        get_default_comptoken_mint(), get_default_global_data(), user_comptoken_wallet, user_data_account,
    ];

    let context = await setup_test(existing_accounts);
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

    let instructions = [
        await createResizeUserDataAccountInstruction(
            /* @ts-ignore */// connection has the important funtions
            connection,
            10,
            context.payer.publicKey,
            user.publicKey,
            user_comptoken_wallet.address,
            compto_public_keys,
        )
    ];

    context = await run_test("growUserDataAccount", context, instructions, [context.payer, user], false, async (context, result) => {
        const packed_final_user_data_account = await context.banksClient.getAccount(user_data_account.address);
        Assert.assertNotNull(packed_final_user_data_account, "user data account exists");
        Assert.assertEqual(UserData.MIN_SIZE + 32 * 9, packed_final_user_data_account.data.length, "user data account size");
    });
}

(async () => { await test_resizeUserDataInstruction_grow(); })();
