import { Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_extra_account_metas_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_user_data_account,
    GlobalDataAccount,
    TokenAccount,
    UserDataAccount
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createVerifyHumanInstruction } from "../instruction.js";

async function testVerifyHuman() {
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

    context = await run_test("VerifyHuman", context, instructions, [context.payer, user], false, async (context, result) => {
        const final_user_data_account = await get_account(context, user_data_pda, UserDataAccount);
        Assert.assert(final_user_data_account.data.isVerifiedHuman, "user data isVerifiedHuman");

        const final_user_comptoken_wallet = await get_account(context, original_user_comptoken_wallet.address, TokenAccount);
        // one billionth of one billion tokens
        Assert.assertEqual(final_user_comptoken_wallet.data.amount, original_user_comptoken_wallet.data.amount + 1n, "user comptoken wallet amount");

        const final_global_data = await get_account(context, original_global_data.address, GlobalDataAccount);
        Assert.assertEqual(
            final_global_data.data.dailyDistributionData.verifiedHumans,
            original_global_data.data.dailyDistributionData.verifiedHumans + 1n,
            "global data totalVerifiedHumans"
        );
    });

    Assert.assert(false, "this test is currently for manual verification only");
}

(async () => { await testVerifyHuman(); })();