import {
    get_default_comptoken_mint,
    get_default_global_data,
    get_default_unpaid_interest_bank,
    get_default_unpaid_ubi_bank,
    MintAccount,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { comptoken_mint_pubkey } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createDailyDistributionEventInstruction } from "../instruction.js";

async function test_earlyDailyDistributionEvent() {
    let comptoken_mint = get_default_comptoken_mint();
    comptoken_mint.data.supply += 1n;
    let accounts = [
        comptoken_mint,
        get_default_global_data(),
        get_default_unpaid_interest_bank(),
        get_default_unpaid_ubi_bank(),
    ];

    let context = await setup_test(accounts);

    let instructions = [await createDailyDistributionEventInstruction()];
    let result;

    [context, result] = await run_test("dailyDistributionEvent", context, instructions, [context.payer], async (context, result) => {
        Assert.assert(result.meta.logMessages.some((msg, i) => msg.includes("daily distribution already called today")), "daily distribution already called");

        const failMint = await get_account(context, comptoken_mint_pubkey, MintAccount);
        // no new distribution because it is the same day 
        Assert.assertEqual(failMint.data.supply, comptoken_mint.data.supply, "interest has not been issued");
    });
}

(async () => { await test_earlyDailyDistributionEvent(); })();

