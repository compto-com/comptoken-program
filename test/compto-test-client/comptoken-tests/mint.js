import { TokenAccount } from "@compto/comptoken.js";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_global_data,
} from "../accounts.js";
import { Assert } from "../assert.js";
import {
    compto_public_keys,
} from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createTestInstruction } from "../instruction.js";

async function test_mint() {
    const testuser = Keypair.generate();
    const user_comptoken_wallet = get_default_comptoken_token_account(PublicKey.unique(), testuser.publicKey);
    const accounts = [get_default_comptoken_mint(), get_default_global_data(), user_comptoken_wallet];

    let context = await setup_test(accounts);

    const amount = 3n;

    let instructions = [await createTestInstruction(testuser.publicKey, user_comptoken_wallet.address, amount, compto_public_keys)];

    context = await run_test("mint", context, instructions, [context.payer, testuser], false, async (context, result) => {
        const final_user_comptoken_wallet = await get_account(context, user_comptoken_wallet.address, TokenAccount);
        Assert.assertEqual(
            final_user_comptoken_wallet.data.amount,
            user_comptoken_wallet.data.amount + amount,
            "user comptoken wallet amount"
        );
    });
}

(async () => { await test_mint(); })();
