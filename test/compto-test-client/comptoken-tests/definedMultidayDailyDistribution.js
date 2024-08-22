import { Keypair, PublicKey } from "@solana/web3.js";
import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_unpaid_interest_bank,
    get_default_unpaid_verified_human_ubi_bank,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { COMPTOKEN_DISTRIBUTION_MULTIPLIER } from "../common.js";
import { DaysParameters, generic_daily_distribution_assertions, run_multiday_test, setup_test, YesterdaysAccounts } from "../generic_test.js";
import { createDailyDistributionEventInstruction, createTestInstruction } from "../instruction.js";
import { clamp } from "../utils.js";

class DefinedMultidayDailyDistributionDaysParameters extends DaysParameters {
    static yesterdays_accounts;

    testuser;
    payer;
    user_comptoken_token_account_address;
    comptokens_minted;
    max_hwm_increase;
    added_asserts = [];

    assert_fn = async (context, result) => {
        const yesterdays_accounts = DefinedMultidayDailyDistributionDaysParameters.yesterdays_accounts;
        const yesterdays_comptoken_mint = yesterdays_accounts.comptoken_mint;
        const yesterdays_global_data_account = yesterdays_accounts.global_data_account;
        const yesterdays_unpaid_interest_bank = yesterdays_accounts.unpaid_interest_bank;
        const yesterdays_unpaid_verified_human_ubi_bank = yesterdays_accounts.unpaid_verified_human_ubi_bank;
        const yesterdays_unpaid_future_ubi_bank = yesterdays_accounts.unpaid_future_ubi_bank;

        const high_watermark = yesterdays_global_data_account.data.dailyDistributionData.highWaterMark;
        const uncapped_hwm_increase = this.comptokens_minted - high_watermark;
        const high_watermark_increase = clamp(0n, uncapped_hwm_increase, this.max_hwm_increase);

        const initial_supply = yesterdays_global_data_account.data.dailyDistributionData.yesterdaySupply;

        await generic_daily_distribution_assertions(context, result, yesterdays_accounts, this.day, this.comptokens_minted, 0n, 0n);

        const todays_accounts = await YesterdaysAccounts.get_accounts(context);
        const todays_comptoken_mint = todays_accounts.comptoken_mint;
        const todays_global_data_account = todays_accounts.global_data_account;
        const todays_unpaid_interest_bank = todays_accounts.unpaid_interest_bank;
        const todays_unpaid_verified_human_ubi_bank = todays_accounts.unpaid_verified_human_ubi_bank;
        const todays_unpaid_future_ubi_bank = todays_accounts.unpaid_future_ubi_bank;

        const actual_hwm_increase = todays_global_data_account.data.dailyDistributionData.highWaterMark - yesterdays_global_data_account.data.dailyDistributionData.highWaterMark;
        Assert.assertEqual(actual_hwm_increase, high_watermark_increase, "high watermark increased by correct amount");

        const supply_increase = high_watermark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER
        Assert.assertEqual(
            todays_comptoken_mint.data.supply,
            yesterdays_comptoken_mint.data.supply + supply_increase + this.comptokens_minted,
            "comptokens distributed");


        const distribution_split = (supply_increase / 2n);
        const naive_interest_distribution = distribution_split;
        const total_ubi_distribution = distribution_split;
        const initial_unpaid_future_ubi_bank = yesterdays_unpaid_future_ubi_bank.data.amount;
        const future_ubi_interest = BigInt(Math.round((Number(naive_interest_distribution) / Number(initial_supply + this.comptokens_minted)) * Number(initial_unpaid_future_ubi_bank)));
        Assert.assertEqual(
            todays_unpaid_interest_bank.data.amount,
            yesterdays_unpaid_interest_bank.data.amount + naive_interest_distribution - future_ubi_interest,
            "interest bank has increased");

        Assert.assertEqual(todays_unpaid_verified_human_ubi_bank.data.amount, yesterdays_unpaid_verified_human_ubi_bank.data.amount, "verified human UBI bank has not changed");

        Assert.assertEqual(todays_unpaid_future_ubi_bank.data.amount,
            yesterdays_unpaid_future_ubi_bank.data.amount + total_ubi_distribution + future_ubi_interest, // no verified humans so all ubi goes to future
            "future UBI bank has increased");

        for (const added_assert of this.added_asserts) {
            added_assert(context, result, yesterdays_accounts, todays_accounts);
        }

        DefinedMultidayDailyDistributionDaysParameters.yesterdays_accounts = todays_accounts;
    }

    constructor(day, testuser, payer, user_comptoken_token_account_address, comptokens_minted, max_hwm_increase) {
        super(day);
        this.testuser = testuser;
        this.payer = payer;
        this.user_comptoken_token_account_address = user_comptoken_token_account_address;
        this.comptokens_minted = BigInt(comptokens_minted);
        this.max_hwm_increase = BigInt(max_hwm_increase);
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

    add_asserts(assert_fn) {
        this.added_asserts.push(assert_fn);
        return this;
    }
}

async function test_multidayDailyDistribution() {
    const testuser = Keypair.generate();
    const user_comptoken_token_account = get_default_comptoken_token_account(PublicKey.unique(), testuser.publicKey);

    const initial_supply = 1_000_000_000n;
    const high_watermark = 6_750n;
    const initial_unpaid_interest_bank = 17_000_000n;
    const initial_unpaid_future_ubi_bank = 957_000_000n;
    // values reflect somewhat reasonable values for an initial supply of 1,000,000,000 (assuming banks werent ever emptied)

    let original_comptoken_mint = get_default_comptoken_mint();
    original_comptoken_mint.data.supply = initial_supply;
    let original_global_data_account = get_default_global_data();
    original_global_data_account.data.dailyDistributionData.yesterdaySupply = initial_supply;
    original_global_data_account.data.dailyDistributionData.highWaterMark = high_watermark;
    let original_unpaid_interest_bank = get_default_unpaid_interest_bank();
    original_unpaid_interest_bank.data.amount = initial_unpaid_interest_bank;
    const original_unpaid_verified_human_ubi_bank = get_default_unpaid_verified_human_ubi_bank();
    let original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();
    original_unpaid_future_ubi_bank.data.amount = initial_unpaid_future_ubi_bank;

    const existing_accounts = [
        original_comptoken_mint, original_global_data_account, original_unpaid_interest_bank, original_unpaid_verified_human_ubi_bank,
        original_unpaid_future_ubi_bank, user_comptoken_token_account
    ];

    let context = await setup_test(existing_accounts);

    let day = 1;
    const new_days_parameters = function (comptokens_minted, max_hwm_increase) {
        return new DefinedMultidayDailyDistributionDaysParameters(day++, testuser, context.payer, user_comptoken_token_account.address, comptokens_minted, max_hwm_increase);
    };

    DefinedMultidayDailyDistributionDaysParameters.yesterdays_accounts = new YesterdaysAccounts(original_comptoken_mint, original_global_data_account, original_unpaid_interest_bank, original_unpaid_verified_human_ubi_bank, original_unpaid_future_ubi_bank);

    let days_parameters_arr = [
        // hwm: 6,750
        new_days_parameters(0n, 17n), // no distribution
        // hwm: 6,750
        new_days_parameters(6749n, 17n), // no distribution
        // hwm: 6,750
        new_days_parameters(6750n, 17n), // no distribution
        // hwm: 6750
        new_days_parameters(6751n, 17n) // 146,000 distributed
            .add_asserts((context, result, yesterdays_accounts, todays_accounts) => {
                Assert.assertEqual(
                    todays_accounts.comptoken_mint.data.supply,
                    yesterdays_accounts.comptoken_mint.data.supply + 6751n + 146_000n,
                    "supply has increased by 146000"
                );
            }),
        // hwm: 6751
        new_days_parameters(6768n, 17n) // 17 * 146000 distributed
            .add_asserts((context, result, yesterdays_accounts, todays_accounts) => {
                Assert.assertEqual(
                    todays_accounts.comptoken_mint.data.supply,
                    yesterdays_accounts.comptoken_mint.data.supply + 6768n + 17n * 146_000n,
                    "supply has increased by 146000"
                );
            }),
        // hwm: 6768
        new_days_parameters(6786n, 17n) // 17 * 146000 distributed
            .add_asserts((context, result, yesterdays_accounts, todays_accounts) => {
                Assert.assertEqual(
                    todays_accounts.comptoken_mint.data.supply,
                    yesterdays_accounts.comptoken_mint.data.supply + 6786n + 17n * 146_000n,
                    "supply has increased by 146000"
                );
            }),
        // hwm: 6785
        new_days_parameters(7000n, 17n) // 17 * 146000 distributed
            .add_asserts((context, result, yesterdays_accounts, todays_accounts) => {
                Assert.assertEqual(
                    todays_accounts.comptoken_mint.data.supply,
                    yesterdays_accounts.comptoken_mint.data.supply + 7000n + 17n * 146_000n,
                    "supply has increased by 146000"
                );
            }),
        // hwm: 6802
    ];

    await run_multiday_test("multiday_daily_distribution_1", context, days_parameters_arr);
}

(async () => { await test_multidayDailyDistribution(); })();