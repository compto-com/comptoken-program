import { Keypair, PublicKey } from "@solana/web3.js";

import { get_default_comptoken_mint, get_default_comptoken_wallet, get_default_global_data, get_default_user_data_account, UserData } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey } from "../common.js";
import { run_test, setup_test } from "../generic_test.js";
import { createGrowUserDataAccountInstruction } from "../instruction.js";

async function test_growUserDataAccount() {
    const user = Keypair.generate();

    const user_comptoken_wallet = get_default_comptoken_wallet(PublicKey.unique(), user.publicKey);
    const user_data_pda = PublicKey.findProgramAddressSync([user_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    const user_data_account = get_default_user_data_account(user_data_pda);

    const existing_accounts = [
        get_default_comptoken_mint(), get_default_global_data(), user_comptoken_wallet, user_data_account,
    ];

    let context = await setup_test(existing_accounts);

    const new_user_data_size = BigInt(UserData.MIN_SIZE + 32 * 10);
    let instructions = [
        await createGrowUserDataAccountInstruction(context, new_user_data_size, context.payer.publicKey, user.publicKey, user_comptoken_wallet.address)
    ];
    let result;

    context.banksClient.getAccount(user_data_account.address);
    [context, result] = await run_test("growUserDataAccount", context, instructions, [context.payer, user], async (context, result) => {
        const packed_final_user_data_account = await context.banksClient.getAccount(user_data_account.address);
        Assert.assertEqual(new_user_data_size, BigInt(packed_final_user_data_account.data.length));
    });
}

(async () => { await test_growUserDataAccount(); })();
