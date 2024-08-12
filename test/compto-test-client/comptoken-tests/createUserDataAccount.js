import { Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_wallet,
    get_default_global_data,
    UserData,
    UserDataAccount
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, DEFAULT_DISTRIBUTION_TIME } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createCreateUserDataAccountInstruction } from "../instruction.js";

async function test_createUserDataAccount() {
    const user = Keypair.generate();

    const original_user_comptoken_wallet = get_default_comptoken_wallet(PublicKey.unique(), user.publicKey);

    const existing_accounts = [get_default_comptoken_mint(), get_default_global_data(), original_user_comptoken_wallet];

    let context = await setup_test(existing_accounts);

    const instructions = [
        await createCreateUserDataAccountInstruction(context, BigInt(UserData.MIN_SIZE), context.payer.publicKey, user.publicKey, original_user_comptoken_wallet.address),
    ];
    let result;

    [context, result] = await run_test("createUserDataAccount", context, instructions, [context.payer, user], async (context, result) => {
        const user_data_pda = PublicKey.findProgramAddressSync([original_user_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];
        const final_user_data_account = await get_account(context, user_data_pda, UserDataAccount);
        Assert.assertEqual(final_user_data_account.data.lastInterestPayoutDate, DEFAULT_DISTRIBUTION_TIME, "user data lastInterestPayoutDate");
        Assert.assert(!final_user_data_account.data.isVerifiedHuman, "user data isVerifiedHuman");
    });
}

(async () => { await test_createUserDataAccount(); })();