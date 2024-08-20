import { Clock } from "solana-bankrun";
import {
    get_default_comptoken_mint,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_unpaid_interest_bank,
    get_default_unpaid_verified_human_ubi_bank,
    GlobalDataAccount,
    MintAccount,
} from "../accounts.js";
import { Assert } from "../assert.js";
import {
    DEFAULT_START_TIME,
    SEC_PER_DAY,
} from "../common.js";
import { Distribution, generic_daily_distribution_assertions, get_account, run_test, setup_test, YesterdaysAccounts } from "../generic_test.js";
import { createDailyDistributionEventInstruction } from "../instruction.js";

async function test_dailyDistributionEvent() {
    const comptokens_minted = 10_000n;
    let original_comptoken_mint = get_default_comptoken_mint();
    original_comptoken_mint.data.supply = comptokens_minted;
    let original_global_data_account = get_default_global_data();
    original_global_data_account.data.dailyDistributionData.verifiedHumans = 1n;
    const original_unpaid_interest_bank = get_default_unpaid_interest_bank();
    const original_unpaid_verified_human_ubi_bank = get_default_unpaid_verified_human_ubi_bank();
    const original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();

    const existing_accounts = [
        original_comptoken_mint, original_global_data_account, original_unpaid_interest_bank, original_unpaid_verified_human_ubi_bank, original_unpaid_future_ubi_bank,
    ];
    const yesterdays_accounts = new YesterdaysAccounts(original_comptoken_mint, original_global_data_account, original_unpaid_interest_bank, original_unpaid_verified_human_ubi_bank, original_unpaid_future_ubi_bank);

    // 216_000 is mostly arbitrary, but it should roughly correspond to a days worth of slots
    let context = await setup_test(existing_accounts, new Clock(216_000n, 0n, 0n, 0n, DEFAULT_START_TIME + SEC_PER_DAY));

    let instructions = [await createDailyDistributionEventInstruction()];

    context = await run_test("dailyDistributionEvent", context, instructions, [context.payer], false, async (context, result) => {
        await generic_daily_distribution_assertions(context, result, yesterdays_accounts, 1n, comptokens_minted);

        const final_comptoken_mint = await get_account(context, original_comptoken_mint.address, MintAccount);
        Assert.assert(final_comptoken_mint.data.supply > original_comptoken_mint.data.supply, "interest has been applied");

        const final_global_data_account = await get_account(context, original_global_data_account.address, GlobalDataAccount);

        const final_daily_distribution_data = final_global_data_account.data.dailyDistributionData;
        const original_daily_distribution_data = original_global_data_account.data.dailyDistributionData;
        Assert.assert(final_daily_distribution_data.highWaterMark > original_daily_distribution_data.highWaterMark, "highwater mark has increased");

        const high_watermark_increase = comptokens_minted;
        const distribution = new Distribution(final_daily_distribution_data, high_watermark_increase, yesterdays_accounts.unpaid_future_ubi_bank.data.amount);

        await distribution.assertInterestDistribution(context, yesterdays_accounts.unpaid_interest_bank, 0n);
        await distribution.assertVerifiedHumanUBIDistribution(context, yesterdays_accounts.unpaid_verified_human_ubi_bank, 0n);
    });
}

(async () => { await test_dailyDistributionEvent(); })();
