import { Clock } from "solana-bankrun";

import {
    get_default_comptoken_mint,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_unpaid_interest_bank,
    get_default_unpaid_verified_human_ubi_bank,
    GlobalDataAccount,
    MintAccount,
    TokenAccount,
} from "../accounts.js";
import { Assert } from "../assert.js";
import {
    COMPTOKEN_DISTRIBUTION_MULTIPLIER,
    DEFAULT_START_TIME,
    SEC_PER_DAY,
} from "../common.js";
import { generic_daily_distribution_assertions, get_account, run_test, setup_test, YesterdaysAccounts } from "../generic_test.js";
import { createDailyDistributionEventInstruction } from "../instruction.js";
import { clamp } from "../utils.js";

/**
 * @param {{testname: string,
 *          initial_supply: BigInt | number,
 *          comptokens_minted: BigInt | number,
 *          high_watermark: BigInt | number,
 *          max_hwm_increase: BigInt | number,
 *          initial_unpaid_interest_bank: BigInt | number,
 *          initial_unpaid_future_ubi_bank: BigInt | number,
 *        }} inputs 
 */
export async function testDailyDistributionEvent(inputs) {
    const testname = inputs.testname
    const initial_supply = BigInt(inputs.initial_supply);
    const comptokens_minted = BigInt(inputs.comptokens_minted);
    const high_watermark = BigInt(inputs.high_watermark);
    const max_hwm_increase = BigInt(inputs.max_hwm_increase);
    const initial_unpaid_interest_bank = BigInt(inputs.initial_unpaid_interest_bank);
    const initial_unpaid_future_ubi_bank = BigInt(inputs.initial_unpaid_future_ubi_bank);

    const high_watermark_increase = clamp(0n, comptokens_minted - high_watermark, max_hwm_increase);

    let original_comptoken_mint = get_default_comptoken_mint();
    original_comptoken_mint.data.supply = initial_supply + comptokens_minted;
    let original_global_data_account = get_default_global_data();
    original_global_data_account.data.dailyDistributionData.yesterdaySupply = initial_supply;
    original_global_data_account.data.dailyDistributionData.highWaterMark = high_watermark;
    let original_unpaid_interest_bank = get_default_unpaid_interest_bank();
    original_unpaid_interest_bank.data.amount = initial_unpaid_interest_bank;
    const original_unpaid_verified_human_ubi_bank = get_default_unpaid_verified_human_ubi_bank();
    let original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();
    original_unpaid_future_ubi_bank.data.amount = initial_unpaid_future_ubi_bank;

    const existing_accounts = [
        original_comptoken_mint, original_global_data_account, original_unpaid_interest_bank, original_unpaid_verified_human_ubi_bank, original_unpaid_future_ubi_bank,
    ];
    const yesterdays_accounts = new YesterdaysAccounts(original_comptoken_mint, original_global_data_account, original_unpaid_interest_bank, original_unpaid_verified_human_ubi_bank, original_unpaid_future_ubi_bank);

    // 216_000 is mostly arbitrary, but it should roughly correspond to a days worth of slots
    let context = await setup_test(existing_accounts, new Clock(216_000n, 0n, 0n, 0n, DEFAULT_START_TIME + SEC_PER_DAY));

    let instructions = [await createDailyDistributionEventInstruction()];

    context = await run_test(testname, context, instructions, [context.payer], false, async (context, result) => {
        await generic_daily_distribution_assertions(context, result, yesterdays_accounts, 1n, comptokens_minted, 0n, 0n);

        const final_comptoken_mint = await get_account(context, original_comptoken_mint.address, MintAccount);
        const final_global_data_account = await get_account(context, original_global_data_account.address, GlobalDataAccount);

        const actual_hwm_increase = final_global_data_account.data.dailyDistributionData.highWaterMark - original_global_data_account.data.dailyDistributionData.highWaterMark;
        Assert.assertEqual(actual_hwm_increase, high_watermark_increase, "high watermark increased by correct amount");

        const supply_increase = high_watermark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER
        Assert.assertEqual(
            final_comptoken_mint.data.supply,
            original_comptoken_mint.data.supply + supply_increase,
            "comptokens distributed");

        const final_unpaid_interest_bank = await get_account(context, original_unpaid_interest_bank.address, TokenAccount);
        const distribution_split = (supply_increase / 2n);
        const naive_interest_distribution = distribution_split;
        const total_ubi_distribution = distribution_split;
        const future_ubi_interest = BigInt(Math.round((Number(naive_interest_distribution) / Number(initial_supply + comptokens_minted)) * Number(initial_unpaid_future_ubi_bank)));
        Assert.assertEqual(
            final_unpaid_interest_bank.data.amount,
            original_unpaid_interest_bank.data.amount + naive_interest_distribution - future_ubi_interest,
            "interest bank has increased");


        const final_unpaid_verified_human_ubi_bank = await get_account(context, original_unpaid_verified_human_ubi_bank.address, TokenAccount);
        Assert.assertEqual(final_unpaid_verified_human_ubi_bank.data.amount, original_unpaid_verified_human_ubi_bank.data.amount, "verified human UBI bank has not changed");

        const final_unpaid_future_ubi_bank = await get_account(context, original_unpaid_future_ubi_bank.address, TokenAccount);
        Assert.assertEqual(final_unpaid_future_ubi_bank.data.amount,
            original_unpaid_future_ubi_bank.data.amount + total_ubi_distribution + future_ubi_interest, // no verified humans so all ubi goes to future
            "future UBI bank has increased");
    });
}

(async () => {
    await testDailyDistributionEvent({
        testname: "dailyDistribution No Mining",
        initial_supply: 1_000_000_000n,
        comptokens_minted: 0n,
        high_watermark: 6_750n,
        max_hwm_increase: 17,
        initial_unpaid_interest_bank: 17_000_000n,
        initial_unpaid_future_ubi_bank: 957_000_000n,
    });
})();

(async () => {
    await testDailyDistributionEvent({
        testname: "dailyDistribution Under HWM",
        initial_supply: 1_000_000_000n,
        comptokens_minted: 6749n,
        high_watermark: 6_750n,
        max_hwm_increase: 17,
        initial_unpaid_interest_bank: 17_000_000n,
        initial_unpaid_future_ubi_bank: 957_000_000n,
    });
})();

(async () => {
    await testDailyDistributionEvent({
        testname: "dailyDistribution At HWM",
        initial_supply: 1_000_000_000n,
        comptokens_minted: 6750n,
        high_watermark: 6_750n,
        max_hwm_increase: 17,
        initial_unpaid_interest_bank: 17_000_000n,
        initial_unpaid_future_ubi_bank: 957_000_000n,
    });
})();

(async () => {
    await testDailyDistributionEvent({
        testname: "dailyDistribution Below Max HWM",
        initial_supply: 1_000_000_000n,
        comptokens_minted: 6_760n,
        high_watermark: 6_750n,
        max_hwm_increase: 17,
        initial_unpaid_interest_bank: 17_000_000n,
        initial_unpaid_future_ubi_bank: 957_000_000n,
    });
})();

(async () => {
    await testDailyDistributionEvent({
        testname: "dailyDistribution At Max HWM",
        initial_supply: 1_000_000_000n,
        comptokens_minted: 6_767n,
        high_watermark: 6_750n,
        max_hwm_increase: 17,
        initial_unpaid_interest_bank: 17_000_000n,
        initial_unpaid_future_ubi_bank: 957_000_000n,
    });
})();

(async () => {
    await testDailyDistributionEvent({
        testname: "dailyDistribution Above Max HWM",
        initial_supply: 1_000_000_000n,
        comptokens_minted: 6_768n,
        high_watermark: 6_750n,
        max_hwm_increase: 17,
        initial_unpaid_interest_bank: 17_000_000n,
        initial_unpaid_future_ubi_bank: 957_000_000n,
    });
})();