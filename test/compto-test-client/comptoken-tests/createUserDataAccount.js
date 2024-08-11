import { Keypair, PublicKey } from "@solana/web3.js";

import { get_default_comptoken_mint, get_default_global_data, get_default_testuser_comptoken_wallet, UserData, UserDataAccount } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, DEFAULT_DISTRIBUTION_TIME, testuser_comptoken_wallet_pubkey } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createCreateUserDataAccountInstruction } from "../instruction.js";

async function test_createUserDataAccount() {
    const testuser = Keypair.generate();
    const accounts = [
        get_default_comptoken_mint(),
        get_default_global_data(),
        get_default_testuser_comptoken_wallet(testuser.publicKey),
    ];

    let context = await setup_test(accounts);

    const instructions = [
        await createCreateUserDataAccountInstruction(context, BigInt(UserData.MIN_SIZE), context.payer.publicKey, testuser.publicKey, testuser_comptoken_wallet_pubkey),
    ];

    context = await run_test("createUserDataAccount", context, instructions, [context.payer, testuser], async (context, result) => {
        let user_data_account_address = PublicKey.findProgramAddressSync([testuser_comptoken_wallet_pubkey.toBytes()], compto_program_id_pubkey)[0];
        const finalUserData = await get_account(context, user_data_account_address, UserDataAccount);
        Assert.assertEqual(finalUserData.data.lastInterestPayoutDate, DEFAULT_DISTRIBUTION_TIME, "user data lastInterestPayoutDate");
        Assert.assert(!finalUserData.data.isVerifiedHuman, "user data isVerifiedHuman");
    });
}

(async () => { await test_createUserDataAccount(); })();