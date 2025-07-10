import { createCreateUserDataAccountInstruction, UserData, UserDataAccount } from "@compto/comptoken.js";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_global_data,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_public_keys, DEFAULT_DISTRIBUTION_TIME } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";

/**
 * @import { Commitment } from "@solana/web3.js";
 */

async function test_createUserDataAccount() {
    const user = Keypair.generate();

    const original_user_comptoken_wallet = get_default_comptoken_token_account(PublicKey.unique(), user.publicKey);

    const existing_accounts = [get_default_comptoken_mint(), get_default_global_data(), original_user_comptoken_wallet];

    let context = await setup_test(existing_accounts);

    const rent = {
        /**
         * @param {number} dataLength 
         * @param {Commitment} _commitment 
         * @returns 
         */
        getMinimumBalanceForRentExemption: async function (dataLength, _commitment) {
            let rent = await context.banksClient.getRent();
            return Number(rent.minimumBalance(BigInt(dataLength)));
        }
    }

    const instructions = [
        await createCreateUserDataAccountInstruction(
            /* @ts-ignore */// rent has the important funtions
            rent,
            UserData.MIN_SIZE,
            context.payer.publicKey,
            user.publicKey,
            original_user_comptoken_wallet.address,
            compto_public_keys,
        ),
    ];

    context = await run_test("createUserDataAccount", context, instructions, [context.payer, user], false, async (context, result) => {
        const user_data_pda = UserDataAccount.addressFromComptokenAccount(original_user_comptoken_wallet.address, compto_public_keys);
        const final_user_data_account = await get_account(context, user_data_pda, UserDataAccount);
        Assert.assertEqual(final_user_data_account.data.lastInterestPayoutDate, DEFAULT_DISTRIBUTION_TIME, "user data lastInterestPayoutDate");
        Assert.assert(!final_user_data_account.data.isVerifiedHuman, "user data isVerifiedHuman");
    });
}

(async () => { await test_createUserDataAccount(); })();