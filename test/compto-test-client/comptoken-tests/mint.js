import { Keypair, PublicKey } from "@solana/web3.js";

import { get_default_comptoken_mint, get_default_comptoken_wallet, get_default_global_data, TokenAccount } from "../accounts.js";
import { Assert } from "../assert.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createTestInstruction } from "../instruction.js";

async function test_mint() {
    const testuser = Keypair.generate();
    const user_comptoken_wallet = get_default_comptoken_wallet(PublicKey.unique(), testuser.publicKey);
    const accounts = [get_default_comptoken_mint(), get_default_global_data(), user_comptoken_wallet];

    let context = await setup_test(accounts);

    let instructions = [await createTestInstruction(testuser.publicKey, user_comptoken_wallet.address)];
    let result;

    [context, result] = await run_test("mint", context, instructions, [context.payer, testuser], async (context, result) => {
        const final_user_comptoken_wallet = await get_account(context, user_comptoken_wallet.address, TokenAccount);
        Assert.assertEqual(
            final_user_comptoken_wallet.data.amount,
            user_comptoken_wallet.data.amount + 2n // MAGIC NUMBER: ensure it remains consistent with comptoken.rs
        );
    });
}

(async () => { await test_mint(); })();
