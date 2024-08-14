import { Clock } from "solana-bankrun";
import {
    get_default_comptoken_mint,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_unpaid_interest_bank,
    get_default_unpaid_verified_human_ubi_bank,
    GlobalDataAccount,
    MintAccount,
    TokenAccount
} from "../accounts.js";
import { Assert } from "../assert.js";
import {
    DEFAULT_ANNOUNCE_TIME,
    DEFAULT_DISTRIBUTION_TIME,
    SEC_PER_DAY,
} from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createDailyDistributionEventInstruction } from "../instruction.js";

async function test_dailyDistributionEvent() {
    let original_comptoken_mint = get_default_comptoken_mint();
    original_comptoken_mint.data.supply = 10_000n;
    let original_global_data_account = get_default_global_data();
    original_global_data_account.data.dailyDistributionData.verifiedHumans = 1n;
    const original_unpaid_interest_bank = get_default_unpaid_interest_bank();
    const original_unpaid_verified_human_ubi_bank = get_default_unpaid_verified_human_ubi_bank();
    const original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();

    const existing_accounts = [
        original_comptoken_mint, original_global_data_account, original_unpaid_interest_bank, original_unpaid_verified_human_ubi_bank, original_unpaid_future_ubi_bank,
    ];

    // 216_000 is mostly arbitrary, but it should roughly correspond to a days worth of slots
    let context = await setup_test(existing_accounts, new Clock(216_000n, 0n, 0n, 0n, DEFAULT_DISTRIBUTION_TIME + SEC_PER_DAY + 1n));

    let instructions = [await createDailyDistributionEventInstruction()];
    let result;

    [context, result] = await run_test("dailyDistributionEvent", context, instructions, [context.payer], async (context, result) => {
        const final_comptoken_mint = await get_account(context, original_comptoken_mint.address, MintAccount);
        Assert.assert(final_comptoken_mint.data.supply > original_comptoken_mint.data.supply, "interest has been applied");

        const final_global_data_account = await get_account(context, original_global_data_account.address, GlobalDataAccount);

        const final_valid_blockhash = final_global_data_account.data.validBlockhashes;
        const original_valid_blockhash = original_global_data_account.data.validBlockhashes;
        Assert.assertEqual(
            final_valid_blockhash.announcedBlockhashTime,
            DEFAULT_ANNOUNCE_TIME + SEC_PER_DAY,
            "the announced blockhash time has been updated"
        );
        Assert.assertNotEqual(
            final_valid_blockhash.announcedBlockhash,
            original_valid_blockhash.announcedBlockhash,
            "announced blockhash has changed"
        ); // TODO: can the actual blockhash be predicted/gotten?
        Assert.assertEqual(
            final_valid_blockhash.validBlockhashTime, DEFAULT_DISTRIBUTION_TIME + SEC_PER_DAY, "the valid blockhash time has been updated"
        );
        Assert.assertNotEqual(final_valid_blockhash.validBlockhash, original_valid_blockhash.validBlockhash, "valid blockhash has changed");

        const final_daily_distribution_data = final_global_data_account.data.dailyDistributionData;
        const original_daily_distribution_data = original_global_data_account.data.dailyDistributionData;
        Assert.assert(final_daily_distribution_data.highWaterMark > original_daily_distribution_data.highWaterMark, "highwater mark has increased");
        Assert.assertEqual(
            final_daily_distribution_data.lastDailyDistributionTime,
            DEFAULT_DISTRIBUTION_TIME + SEC_PER_DAY,
            "last daily distribution time has updated"
        );
        Assert.assertEqual(
            final_daily_distribution_data.yesterdaySupply,
            final_comptoken_mint.data.supply,
            "yesterdays supply is where the mint is after"
        );
        Assert.assertEqual(
            final_daily_distribution_data.oldestHistoricValue,
            original_daily_distribution_data.oldestHistoricValue + 1n,
            "oldest interests has increased"
        );

        const final_interest_bank_account = await get_account(context, original_unpaid_interest_bank.address, TokenAccount);
        Assert.assert(final_interest_bank_account.data.amount > original_unpaid_interest_bank.data.amount, "interest bank has increased");

        const final_unpaid_verified_human_ubi_bank_account = await get_account(context, original_unpaid_verified_human_ubi_bank.address, TokenAccount);
        Assert.assert(final_unpaid_verified_human_ubi_bank_account.data.amount > original_unpaid_verified_human_ubi_bank.data.amount, "Verified Human UBI bank has increased");

        const final_unpaid_future_ubi_bank_account = await get_account(context, original_unpaid_future_ubi_bank.address, TokenAccount);
        Assert.assert(final_unpaid_future_ubi_bank_account.data.amount > original_unpaid_future_ubi_bank.data.amount, "Future UBI bank has increased");
    });
}

(async () => { await test_dailyDistributionEvent(); })();
