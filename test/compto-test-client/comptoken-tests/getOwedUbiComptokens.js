import {
    createGetOwedComptokensInstruction,
    SEC_PER_DAY,
    TokenAccount,
    UserDataAccount,
} from "@compto/comptoken.js";
import { Keypair, PublicKey, } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_extra_account_metas_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_unpaid_interest_bank,
    get_default_unpaid_verified_human_ubi_bank,
    get_default_user_data_account,
} from "../accounts.js";
import { Assert } from "../assert.js";
import {
    compto_public_keys,
    DEFAULT_DISTRIBUTION_TIME,
} from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";

async function test_getOwedUbiComptokens() {
    const user = Keypair.generate();

    let comptoken_mint = get_default_comptoken_mint();
    comptoken_mint.data.supply = 2_000_004n

    let original_user_comptoken_wallet = get_default_comptoken_token_account(PublicKey.unique(), user.publicKey);
    original_user_comptoken_wallet.data.amount = 2n;

    const user_data_pda = PublicKey.findProgramAddressSync([original_user_comptoken_wallet.address.toBytes()], compto_public_keys.compto_program_id_pubkey)[0];
    let original_user_data_account = get_default_user_data_account(user_data_pda);
    original_user_data_account.data.lastInterestPayoutDate = DEFAULT_DISTRIBUTION_TIME - BigInt(SEC_PER_DAY);
    original_user_data_account.data.isVerifiedHuman = true;

    let global_data = get_default_global_data();
    global_data.data.dailyDistributionData.verifiedHumans = 1n;
    global_data.data.dailyDistributionData.historicDistributions[0].interestRate = 1.5;
    global_data.data.dailyDistributionData.historicDistributions[0].ubiAmount = 2n;
    global_data.data.dailyDistributionData.oldestHistoricValue = 1n;
    global_data.data.dailyDistributionData.yesterdaySupply = 2_000_004n;

    let interest_bank = get_default_unpaid_interest_bank();
    interest_bank.data.amount = 1_000_001n;

    let ubi_bank = get_default_unpaid_verified_human_ubi_bank();
    ubi_bank.data.amount = 2n;

    let future_ubi_bank = get_default_unpaid_future_ubi_bank();
    future_ubi_bank.data.amount = 999_999n;

    const existing_accounts = [
        comptoken_mint,
        global_data,
        interest_bank,
        ubi_bank,
        future_ubi_bank,
        original_user_comptoken_wallet,
        original_user_data_account,
        get_default_extra_account_metas_account(),
    ];

    let context = await setup_test(existing_accounts);

    let instructions = [await createGetOwedComptokensInstruction(user.publicKey, original_user_comptoken_wallet.address, compto_public_keys)];

    context = await run_test("getOwedComptokens", context, instructions, [context.payer, user], false, async (context, result) => {
        const final_user_comptoken_wallet = await get_account(context, original_user_comptoken_wallet.address, TokenAccount);
        Assert.assertEqual(final_user_comptoken_wallet.data.amount, 5n, "interest amount");

        const final_user_data_account = await get_account(context, original_user_data_account.address, UserDataAccount);
        Assert.assertEqual(final_user_data_account.data.lastInterestPayoutDate, DEFAULT_DISTRIBUTION_TIME, "last interest payout date updated");
    });
}

(async () => { await test_getOwedUbiComptokens(); })();
