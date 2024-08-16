import { Keypair, PublicKey } from "@solana/web3.js";

import { get_default_comptoken_mint, get_default_comptoken_wallet, get_default_global_data, get_default_user_data_account, UserData } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey } from "../common.js";
import { run_test, setup_test } from "../generic_test.js";
import { createGrowUserDataAccountInstruction } from "../instruction.js";

async function test_failShrinkUserDataAccount() {
    const user = Keypair.generate();

    const user_comptoken_wallet = get_default_comptoken_wallet(PublicKey.unique(), user.publicKey);
    const user_data_pda = PublicKey.findProgramAddressSync([user_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    const user_data_account = get_default_user_data_account(user_data_pda);
    const accounts = [get_default_comptoken_mint(), get_default_global_data(), user_comptoken_wallet, user_data_account];

    let context = await setup_test(accounts);

    let new_user_data_size = BigInt(UserData.MIN_SIZE);
    let instructions = [
        await createGrowUserDataAccountInstruction(
            context, new_user_data_size, context.payer.publicKey, user.publicKey, user_comptoken_wallet.address
        ),
    ];
    let result;

    [context, result] = await run_test("failShrinkUserDataAccount", context, instructions, [context.payer, user], async (context, result) => {
        Assert.assertNotNull(result.result, "program should fail");
        console.log(result.meta.logMessages);
        Assert.assert(
            result.meta.logMessages.some((msg, i) => msg.includes("assertion failed: user_data_account.data_len() < new_size")),
            "program should have failed b/c it wouldn't shrink"
        );
    }, true);
}

(async () => { await test_failShrinkUserDataAccount(); })();
