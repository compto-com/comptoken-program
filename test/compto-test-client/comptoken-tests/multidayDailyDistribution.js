import { Keypair, PublicKey } from "@solana/web3.js";
import { Clock, ProgramTestContext } from "solana-bankrun";
import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_unpaid_interest_bank,
    get_default_unpaid_verified_human_ubi_bank,
    GlobalDataAccount,
    MintAccount,
} from "../accounts.js";
import { Assert, AssertionError } from "../assert.js";
import {
    COMPTOKEN_DISTRIBUTION_MULTIPLIER,
    comptoken_mint_pubkey,
    DEFAULT_ANNOUNCE_TIME,
    DEFAULT_DISTRIBUTION_TIME,
    DEFAULT_START_TIME,
    global_data_account_pubkey,
    SEC_PER_DAY,
} from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createDailyDistributionEventInstruction, createTestInstruction } from "../instruction.js";

/**
 * @param {ProgramTestContext} context
 * @param {BigInt} new_day
 */
async function advance_to_day(context, new_day) {
    const SLOTS_PER_DAY = 216_000n; // roughly a days worth of slots
    const current_slot = SLOTS_PER_DAY * BigInt(new_day);
    let new_clock = new Clock(current_slot, 0n, 0n, 0n, DEFAULT_START_TIME + (SEC_PER_DAY * BigInt(new_day)));
    context.setClock(new_clock);
    return context;
}

// arbitrary function to produce "how many comptokens are minted on a given day" test data
function get_comptokens_minted(current_day) {
    return 1n + (BigInt(current_day) / 10n);
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

    let days_parameters_arr = Array.from({ length: 100 }, (_, i) => { return { comptokens_minted: get_comptokens_minted(i) } });
    // first 10 days mint 1 comptoken, next 10 days mint 2 comptokens, etc

    for (let days_parameters of days_parameters_arr) {
        context = await test_day(context, days_parameters, user_comptoken_token_account.address, testuser);
    }
}

let GLOBAL_TODAY = 1n;
let GLOBAL_YESTERDAYS_GLOBAL_DATA_ACCOUNT = get_default_global_data();

/**
 * @param {ProgramTestContext} context 
 * @param {{comptokens_minted: BigInt}} current_day 
 * @returns {ProgramTestContext}
 */
async function test_day(context, days_parameters, user_comptoken_token_account_address, testuser) {
    let mint_instructions = [await createTestInstruction(testuser.publicKey, user_comptoken_token_account_address, days_parameters.comptokens_minted)];
    context = await run_test("multiday mint " + GLOBAL_TODAY, context, mint_instructions, [context.payer, testuser], false, async (context, result) => { });
    console.log("minted %d on day %d", days_parameters.comptokens_minted, GLOBAL_TODAY);

    GLOBAL_YESTERDAYS_GLOBAL_DATA_ACCOUNT = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
    advance_to_day(context, GLOBAL_TODAY);

    let instructions = [await createDailyDistributionEventInstruction()];
    context = await run_test("multiday day " + GLOBAL_TODAY, context, instructions, [context.payer], false, async (context, result) => {
        try {
            await assert_day(context, result);
        } catch (error) {
            if (error instanceof AssertionError) {
                throw error.addNote("current day: " + GLOBAL_TODAY);
            }
            throw error;
        }
    });

    GLOBAL_TODAY++;
    return context;
}

async function assert_day(context, result) {
    const current_comptoken_mint = await get_account(context, comptoken_mint_pubkey, MintAccount);
    const current_global_data_account = await get_account(context, global_data_account_pubkey, GlobalDataAccount);

    const current_valid_blockhash = current_global_data_account.data.validBlockhashes;
    const yesterdays_valid_blockhash = GLOBAL_YESTERDAYS_GLOBAL_DATA_ACCOUNT.data.validBlockhashes;
    Assert.assertEqual(
        current_valid_blockhash.announcedBlockhashTime,
        DEFAULT_ANNOUNCE_TIME + (SEC_PER_DAY * GLOBAL_TODAY),
        "the announced blockhash time has been updated"
    );
    Assert.assertNotEqual(
        current_valid_blockhash.announcedBlockhash,
        yesterdays_valid_blockhash.announcedBlockhash,
        "announced blockhash has changed"
    ); // TODO: can the actual blockhash be predicted/gotten?
    Assert.assertEqual(
        current_valid_blockhash.validBlockhashTime,
        DEFAULT_DISTRIBUTION_TIME + (SEC_PER_DAY * GLOBAL_TODAY),
        "the valid blockhash time has been updated"
    );
    Assert.assertNotEqual(current_valid_blockhash.validBlockhash, yesterdays_valid_blockhash.validBlockhash, "valid blockhash has changed");

    const current_daily_distribution_data = current_global_data_account.data.dailyDistributionData;
    Assert.assertEqual(
        current_daily_distribution_data.lastDailyDistributionTime,
        DEFAULT_DISTRIBUTION_TIME + (SEC_PER_DAY * GLOBAL_TODAY),
        "last daily distribution time has updated"
    );
    Assert.assertEqual(
        current_daily_distribution_data.yesterdaySupply,
        current_comptoken_mint.data.supply,
        "yesterdays supply is where the mint is after"
    );
    Assert.assertEqual(
        current_daily_distribution_data.oldestHistoricValue,
        GLOBAL_TODAY % 365n,
        "oldestHistoricValue is updated"
    );

    // yesterdaySupply stores the supply at the start of the day, which is right now.
    const current_supply = current_global_data_account.data.dailyDistributionData.yesterdaySupply;
    const yesterdays_supply = GLOBAL_YESTERDAYS_GLOBAL_DATA_ACCOUNT.data.dailyDistributionData.yesterdaySupply;
    const supply_increase = current_supply - yesterdays_supply;

    const current_highwatermark = current_global_data_account.data.dailyDistributionData.highWaterMark;
    const yesterdays_highwatermark = GLOBAL_YESTERDAYS_GLOBAL_DATA_ACCOUNT.data.dailyDistributionData.highWaterMark;
    const highwatermark_increase = current_highwatermark - yesterdays_highwatermark;

    Assert.assertEqual(
        supply_increase,
        get_comptokens_minted(GLOBAL_TODAY - 1n) + highwatermark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER,
        "supply should increase by comptokens_minted yesterday + high_watermark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER"
    );

    await assert_day_extra(context, result);
}

async function assert_day_extra(context, result) {
    const current_global_data_account = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
    const current_highwatermark = current_global_data_account.data.dailyDistributionData.highWaterMark;
    const yesterdays_highwatermark = GLOBAL_YESTERDAYS_GLOBAL_DATA_ACCOUNT.data.dailyDistributionData.highWaterMark;
    const highwatermark_increase = current_highwatermark - yesterdays_highwatermark;

    // every 10 days the mining increases, so the highwatermark should increase, and comptokens should be distributed
    if (GLOBAL_TODAY % 10n !== 1n) {
        Assert.assertEqual(highwatermark_increase, 0n, "highwatermark should increase by 0");
    }
    else {
        Assert.assertEqual(highwatermark_increase, 1n, "highwatermark should increase by 1");
    }
}

(async () => { await test_multidayDailyDistribution(); })();