import { Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_extra_account_metas_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_user_data_account,
    UserDataAccount
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createVerifyHumanInstruction } from "../instruction.js";

async function test_createUserDataAccount() {
    const user = Keypair.generate();
    let original_comptoken_mint = get_default_comptoken_mint();
    original_comptoken_mint.data.supply = 1_000_000_000n;
    const original_global_data = get_default_global_data();
    let original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();
    original_unpaid_future_ubi_bank.data.amount = 1_000_000_000n;
    const original_user_comptoken_wallet = get_default_comptoken_token_account(PublicKey.unique(), user.publicKey);
    console.log(original_user_comptoken_wallet);
    const user_data_pda = PublicKey.findProgramAddressSync([original_user_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    const original_user_data_account = get_default_user_data_account(user_data_pda);
    console.log(original_user_data_account);

    const existing_accounts = [
        original_comptoken_mint, original_global_data, original_unpaid_future_ubi_bank, original_user_comptoken_wallet, original_user_data_account,
        get_default_extra_account_metas_account()
    ];

    let context = await setup_test(existing_accounts);

    const instructions = [
        await createVerifyHumanInstruction(user.publicKey, original_user_comptoken_wallet.address),
    ];

    context = await run_test("createUserDataAccount", context, instructions, [context.payer, user], false, async (context, result) => {
        const final_user_data_account = await get_account(context, user_data_pda, UserDataAccount);
        Assert.assert(final_user_data_account.data.isVerifiedHuman, "user data isVerifiedHuman");
    });
}

(async () => { await test_createUserDataAccount(); })();