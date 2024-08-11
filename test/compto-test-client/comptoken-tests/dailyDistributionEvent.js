import { Clock } from "solana-bankrun";
import {
    get_default_comptoken_mint,
    get_default_global_data,
    get_default_unpaid_interest_bank,
    get_default_unpaid_ubi_bank,
    GlobalDataAccount,
    MintAccount,
    TokenAccount
} from "../accounts.js";
import { Assert } from "../assert.js";
import {
    comptoken_mint_pubkey,
    DEFAULT_ANNOUNCE_TIME,
    DEFAULT_DISTRIBUTION_TIME,
    global_data_account_pubkey,
    interest_bank_account_pubkey,
    SEC_PER_DAY,
    ubi_bank_account_pubkey
} from "../common.js";
import { get_account, run_test, setup_test, simulate_test } from "../generic_test.js";
import { createDailyDistributionEventInstruction } from "../instruction.js";

async function test_dailyDistributionEvent() {
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
    
    [context, result] = await simulate_test("dailyDistributionEvent", context, instructions, [context.payer], async (context, result) => {
        Assert.assert(result.meta.logMessages.some((msg, i) => msg.includes("daily distribution already called today")), "daily distribution already called");
        
        const failMint = await get_account(context, comptoken_mint_pubkey, MintAccount);
        // no new distribution because it is the same day 
        Assert.assertEqual(failMint.data.supply, comptoken_mint.data.supply, "interest has not been issued");
    });

    context.setClock(new Clock(1n, 0n, 0n, 0n, DEFAULT_DISTRIBUTION_TIME + SEC_PER_DAY + 1n));
    
    [context, result] = await run_test("dailyDistributionEvent", context, instructions, [context.payer], async (context, result) => {
        const finalMint = await get_account(context, comptoken_mint_pubkey, MintAccount);
        Assert.assert(finalMint.data.supply > comptoken_mint.data.supply, "interest has been applied");

        const finalGlobalDataAcct = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
        const default_global_data = get_default_global_data();

        const finalValidBlockhash = finalGlobalDataAcct.data.validBlockhashes;
        const defaultValidBlockhash = default_global_data.data.validBlockhashes;
        Assert.assertEqual(finalValidBlockhash.announcedBlockhashTime, DEFAULT_ANNOUNCE_TIME + SEC_PER_DAY, "the announced blockhash time has been updated");
        Assert.assertNotEqual(finalValidBlockhash.announcedBlockhash, defaultValidBlockhash.announcedBlockhash, "announced blockhash has changed"); // TODO: can the actual blockhash be predicted/gotten?
        Assert.assertEqual(finalValidBlockhash.validBlockhashTime, DEFAULT_DISTRIBUTION_TIME + SEC_PER_DAY, "the valid blockhash time has been updated");
        Assert.assertNotEqual(finalValidBlockhash.validBlockhash, defaultValidBlockhash.validBlockhash, "valid blockhash has changed");

        const finalDailyDistributionData = finalGlobalDataAcct.data.dailyDistributionData;
        const defaultDailyDistributionData = default_global_data.data.dailyDistributionData;
        Assert.assertEqual(finalDailyDistributionData.highWaterMark, 2n, "highwater mark has increased"); // TODO: find a better way to get oracle value
        Assert.assertEqual(finalDailyDistributionData.lastDailyDistributionTime, DEFAULT_DISTRIBUTION_TIME + SEC_PER_DAY, "last daily distribution time has updated");
        Assert.assertEqual(finalDailyDistributionData.yesterdaySupply, finalMint.data.supply, "yesterdays supply is where the mint is after");
        Assert.assertEqual(finalDailyDistributionData.oldestInterest, defaultDailyDistributionData.oldestInterest + 1n, "oldest interests has increased");

        const finalInterestBankAcct = await get_account(context, interest_bank_account_pubkey, TokenAccount);
        Assert.assert(finalInterestBankAcct.data.amount > get_default_unpaid_interest_bank().data.amount, "interest bank has increased");

        const finalUbiBankAcct = await get_account(context, ubi_bank_account_pubkey, TokenAccount);
        Assert.assert(finalUbiBankAcct.data.amount > get_default_unpaid_ubi_bank().data.amount, "interest bank has increased");
    });
}

(async () => { await test_dailyDistributionEvent(); })();
