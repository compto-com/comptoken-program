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
import { DaysParameters, Distribution, generic_daily_distribution_assertions, get_account, run_multiday_test, setup_test, YesterdaysAccounts } from "../generic_test.js";
import { createDailyDistributionEventInstruction, createTestInstruction } from "../instruction.js";

class DefinedMultidayDailyDistributionDaysParameters extends DaysParameters {
    static yesterdays_accounts = new YesterdaysAccounts();

    testuser;
    payer;
    user_comptoken_token_account_address;
    comptokens_minted;

    assert_fn = async (context, result) => {
        const yesterdays_accounts = DefinedMultidayDailyDistributionDaysParameters.yesterdays_accounts;
        await generic_daily_distribution_assertions(context, result, yesterdays_accounts, this.day, get_comptokens_minted(this.day), 0n, 0n);
        const current_global_data_account = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
        const current_highwatermark = current_global_data_account.data.dailyDistributionData.highWaterMark;
        const yesterdays_highwatermark = yesterdays_accounts.global_data_account.data.dailyDistributionData.highWaterMark;
        const highwatermark_increase = current_highwatermark - yesterdays_highwatermark;

        const distribution = new Distribution(current_global_data_account.data.dailyDistributionData, highwatermark_increase, yesterdays_accounts.unpaid_future_ubi_bank.data.amount);

        await distribution.assertInterestDistribution(context, yesterdays_accounts.unpaid_interest_bank, 0n);
        await distribution.assertVerifiedHumanUBIDistribution(context, yesterdays_accounts.unpaid_verified_human_ubi_bank, 0n);
        // future UBI checked in generic_daily_distribution
        DefinedMultidayDailyDistributionDaysParameters.yesterdays_accounts = await YesterdaysAccounts.get_accounts(context);
    }

    constructor(day, testuser, payer, user_comptoken_token_account_address, comptokens_minted) {
        super(day);
        this.testuser = testuser;
        this.payer = payer;
        this.user_comptoken_token_account_address = user_comptoken_token_account_address;
        this.comptokens_minted = BigInt(comptokens_minted);
    }

    async get_setup_instructions() {
        return [await createTestInstruction(this.testuser.publicKey, this.user_comptoken_token_account_address, this.comptokens_minted)];
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

    let day = 1;
    new_days_parameters = function (comptokens_minted) {
        return new DefinedMultidayDailyDistributionDaysParameters(day++, testuser, context.payer, user_comptoken_token_account.address, comptokens_minted);
    };

    let days_parameters_arr = [
        new_days_parameters(0n),
    ];

    await run_multiday_test("multiday_daily_distribution_1", context, days_parameters_arr);
}

(async () => { await test_multidayDailyDistribution(); })();