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
    DEFAULT_START_TIME,
    SEC_PER_DAY,
} from "../common.js";
import { generic_daily_distribution_assertions, get_account, run_test, setup_test, YesterdaysAccounts } from "../generic_test.js";
import { createDailyDistributionEventInstruction } from "../instruction.js";

async function test_dailyDistributionEvent_noMining() {
    const initial_supply = 1_000_000_000n;
    const comptokens_minted = 6_750n;
    const high_watermark = 6_750n; // 6_750n is arbitrary, but it should be a reasonably accurate representation of the highwater mark when the supply is 1_000_000_000
    // max hwm increase is 110
    const initial_unpaid_interest_bank = 17_000_000n; // again arbitrary, but roughly accurate, assuming no payouts
    const initial_unpaid_future_ubi_bank = 957_000_000n; // again arbitrary, but roughly accurate, assuming no payouts
    // bank values estimated using random walk simulation

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

    context = await run_test("dailyDistribution At HWM", context, instructions, [context.payer], false, async (context, result) => {
        await generic_daily_distribution_assertions(context, result, yesterdays_accounts, 1n, comptokens_minted, 0n, 0n);

        const final_comptoken_mint = await get_account(context, original_comptoken_mint.address, MintAccount);
        Assert.assertEqual(final_comptoken_mint.data.supply, original_comptoken_mint.data.supply, "no comptokens distributed");

        const final_global_data_account = await get_account(context, original_global_data_account.address, GlobalDataAccount);

        const final_daily_distribution_data = final_global_data_account.data.dailyDistributionData;
        const original_daily_distribution_data = original_global_data_account.data.dailyDistributionData;
        Assert.assertEqual(final_daily_distribution_data.highWaterMark, original_daily_distribution_data.highWaterMark, "highwater mark has not changed");

        const final_unpaid_interest_bank = await get_account(context, original_unpaid_interest_bank.address, TokenAccount);
        Assert.assertEqual(final_unpaid_interest_bank.data.amount, original_unpaid_interest_bank.data.amount, "interest bank has not changed");

        const final_unpaid_verified_human_ubi_bank = await get_account(context, original_unpaid_verified_human_ubi_bank.address, TokenAccount);
        Assert.assertEqual(final_unpaid_verified_human_ubi_bank.data.amount, original_unpaid_verified_human_ubi_bank.data.amount, "verified human UBI bank has not changed");

        const final_unpaid_future_ubi_bank = await get_account(context, original_unpaid_future_ubi_bank.address, TokenAccount);
        Assert.assertEqual(final_unpaid_future_ubi_bank.data.amount, original_unpaid_future_ubi_bank.data.amount, "future UBI bank has not changed");
    });
}

(async () => { await test_dailyDistributionEvent_noMining(); })();
