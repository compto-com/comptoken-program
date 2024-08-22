import { Keypair, PublicKey } from "@solana/web3.js";
import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_unpaid_interest_bank,
    get_default_unpaid_verified_human_ubi_bank,
    GlobalDataAccount,
} from "../accounts.js";
import { Assert, } from "../assert.js";
import {
    global_data_account_pubkey,
} from "../common.js";
import { DaysParameters, generic_daily_distribution_assertions, get_account, run_multiday_test, setup_test, YesterdaysAccounts } from "../generic_test.js";
import { createDailyDistributionEventInstruction, createTestInstruction } from "../instruction.js";

// arbitrary function to produce "how many comptokens are minted on a given day" test data
function get_comptokens_minted(current_day) {
    // first 10 days mint 1 comptoken, next 10 days mint 2 comptokens, etc
    return 1n + ((BigInt(current_day) - 1n) / 10n);
}

class MultidayDailyDistributionDaysParameters extends DaysParameters {
    static yesterdays_accounts = new YesterdaysAccounts();

    testuser;
    payer;
    user_comptoken_token_account_address;

    assert_fn = async (context, result) => {
        const yesterdays_accounts = MultidayDailyDistributionDaysParameters.yesterdays_accounts;
        await generic_daily_distribution_assertions(context, result, yesterdays_accounts, this.day, get_comptokens_minted(this.day), 0n, 0n);
        const current_global_data_account = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
        const current_highwatermark = current_global_data_account.data.dailyDistributionData.highWaterMark;
        const yesterdays_highwatermark = yesterdays_accounts.global_data_account.data.dailyDistributionData.highWaterMark;
        const highwatermark_increase = current_highwatermark - yesterdays_highwatermark;

        // every 10 days the mining increases, so the highwatermark should increase, and comptokens should be distributed
        if (this.day % 10n === 1n) {
            Assert.assertEqual(highwatermark_increase, 1n, "highwatermark should increase by 1");
        }
        else {
            Assert.assertEqual(highwatermark_increase, 0n, "highwatermark should increase by 0");
        }

        MultidayDailyDistributionDaysParameters.yesterdays_accounts = await YesterdaysAccounts.get_accounts(context);
    }

    constructor(day, testuser, payer, user_comptoken_token_account_address) {
        super(day);
        this.testuser = testuser;
        this.payer = payer;
        this.user_comptoken_token_account_address = user_comptoken_token_account_address;
    }

    async get_setup_instructions() {
        return [await createTestInstruction(this.testuser.publicKey, this.user_comptoken_token_account_address, get_comptokens_minted(this.day))];
    }
    async get_setup_signers() {
        return [this.payer, this.testuser]
    }
    async get_instructions() {
        return [await createDailyDistributionEventInstruction()];
    }
    async get_signers() {
        return [this.payer];
    }
}

async function test_multidayDailyDistribution() {
    // this is a test for daily distributions only, none of the other features are tested
    // it is also a greatly simplified version of reality
    const testuser = Keypair.generate();
    const user_comptoken_token_account = get_default_comptoken_token_account(PublicKey.unique(), testuser.publicKey);
    const original_comptoken_mint = get_default_comptoken_mint();
    const original_global_data_account = get_default_global_data();
    const original_unpaid_interest_bank = get_default_unpaid_interest_bank();
    const original_unpaid_verified_human_ubi_bank = get_default_unpaid_verified_human_ubi_bank();
    const original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();

    const existing_accounts = [
        original_comptoken_mint, original_global_data_account, original_unpaid_interest_bank, original_unpaid_verified_human_ubi_bank,
        original_unpaid_future_ubi_bank, user_comptoken_token_account
    ];

    let context = await setup_test(existing_accounts);

    let days_parameters_arr = Array.from({ length: 100 }, (_, i) => {
        return new MultidayDailyDistributionDaysParameters(i + 1, testuser, context.payer, user_comptoken_token_account.address);
    });

    await run_multiday_test("multiday_daily_distribution_1", context, days_parameters_arr);
}

(async () => { await test_multidayDailyDistribution(); })();