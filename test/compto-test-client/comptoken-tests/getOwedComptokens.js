import { Keypair, PublicKey, } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_wallet,
    get_default_extra_account_metas_account,
    get_default_global_data,
    get_default_unpaid_interest_bank,
    get_default_unpaid_ubi_bank,
    get_default_user_data_account,
    TokenAccount,
    UserDataAccount
} from "../accounts.js";
import { Assert } from "../assert.js";
import {
    compto_program_id_pubkey,
    DEFAULT_DISTRIBUTION_TIME,
    SEC_PER_DAY,
} from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createGetOwedComptokensInstruction } from "../instruction.js";

async function test_getOwedComptokens() {
    const user = Keypair.generate();

    let comptoken_mint = get_default_comptoken_mint();
    comptoken_mint.data.supply = 292_004n

    let original_user_comptoken_wallet = get_default_comptoken_wallet(PublicKey.unique(), user.publicKey);
    original_user_comptoken_wallet.data.amount = 2n;

    const user_data_pda = PublicKey.findProgramAddressSync([original_user_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    let original_user_data_account = get_default_user_data_account(user_data_pda);
    original_user_data_account.data.lastInterestPayoutDate = DEFAULT_DISTRIBUTION_TIME - SEC_PER_DAY;

    let global_data = get_default_global_data();
    global_data.data.dailyDistributionData.historicInterests[0] = 0.5;
    global_data.data.dailyDistributionData.oldestInterest = 1n;
    global_data.data.dailyDistributionData.yesterdaySupply = 292_004n;

    let interest_bank = get_default_unpaid_interest_bank();
    interest_bank.data.amount = 146_000n;

    let ubi_bank = get_default_unpaid_ubi_bank();
    ubi_bank.data.amount = 146_000n;

    const existing_accounts = [
        comptoken_mint, global_data, interest_bank, ubi_bank, original_user_comptoken_wallet, original_user_data_account,
        get_default_extra_account_metas_account(),
    ];

    let context = await setup_test(existing_accounts);

    let instructions = [await createGetOwedComptokensInstruction(user.publicKey, original_user_comptoken_wallet.address)];
    let result;

    [context, result] = await run_test("getOwedComptokens", context, instructions, [context.payer, user], async (context, result) => {
        const final_user_comptoken_wallet = await get_account(context, original_user_comptoken_wallet.address, TokenAccount);
        Assert.assertEqual(final_user_comptoken_wallet.data.amount, 3n, "interest amount");

        const final_user_data_account = await get_account(context, original_user_data_account.address, UserDataAccount);
        Assert.assertEqual(final_user_data_account.data.lastInterestPayoutDate, DEFAULT_DISTRIBUTION_TIME, "last interest payout date updated");
    });
}

(async () => { await test_getOwedComptokens(); })();
