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
    testuser_comptoken_wallet_pubkey
} from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createGetOwedComptokensInstruction } from "../instruction.js";

async function test_getOwedComptokens() {
    const testuser = Keypair.generate();

    let comptoken_mint = get_default_comptoken_mint();
    comptoken_mint.data.supply = 292_004n

    let user_wallet = get_default_comptoken_wallet(testuser_comptoken_wallet_pubkey, testuser.publicKey);
    user_wallet.data.amount = 2n;

    let user_data_account_address = PublicKey.findProgramAddressSync([user_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    let user_data = get_default_user_data_account(user_data_account_address);
    user_data.data.lastInterestPayoutDate = DEFAULT_DISTRIBUTION_TIME - SEC_PER_DAY;

    let global_data = get_default_global_data();
    global_data.data.dailyDistributionData.historicInterests[0] = 0.5;
    global_data.data.dailyDistributionData.oldestInterest = 1n;
    global_data.data.dailyDistributionData.yesterdaySupply = 292_004n;

    let interest_bank = get_default_unpaid_interest_bank();
    interest_bank.data.amount = 146_000n;

    let ubi_bank = get_default_unpaid_ubi_bank();
    ubi_bank.data.amount = 146_000n;

    let accounts = [
        comptoken_mint,
        global_data,
        interest_bank,
        ubi_bank,
        get_default_extra_account_metas_account(),
        user_wallet,
        user_data,
    ];

    let context = await setup_test(accounts);

    let instructions = [await createGetOwedComptokensInstruction(testuser.publicKey, user_wallet.address)];
    let result;

    [context, result] = await run_test("getOwedComptokens", context, instructions, [context.payer, testuser], async (context, result) => {
        const finalUserWallet = await get_account(context, user_wallet.address, TokenAccount);
        Assert.assertEqual(finalUserWallet.data.amount, 3n, "interest amount");

        const finalUserData = await get_account(context, user_data.address, UserDataAccount);
        Assert.assertEqual(finalUserData.data.lastInterestPayoutDate, DEFAULT_DISTRIBUTION_TIME, "last interest payout date updated");
    });
}

(async () => { await test_getOwedComptokens(); })();
