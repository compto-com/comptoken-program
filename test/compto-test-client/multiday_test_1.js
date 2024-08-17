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
    TokenAccount
} from "./accounts.js";
import { Assert } from "./assert.js";
import {
    comptoken_mint_pubkey,
    DEFAULT_ANNOUNCE_TIME,
    DEFAULT_DISTRIBUTION_TIME,
    DEFAULT_START_TIME,
    global_data_account_pubkey,
    SEC_PER_DAY,
} from "./common.js";
import { get_account, run_test, run_test_quiet, setup_test } from "./generic_test.js";
import { createDailyDistributionEventInstruction, createTestInstruction } from "./instruction.js";

/**
 * @param {ProgramTestContext} context
 * @param {BigInt} current_day
 */
async function advance_to_day(context, current_day) {
    const SLOTS_PER_DAY = 216_000n; // roughly a days worth of slots
    const current_slot = SLOTS_PER_DAY * current_day;
    let new_clock = new Clock(current_slot, 0n, 0n, 0n, DEFAULT_START_TIME + (SEC_PER_DAY * current_day));
    context.setClock(new_clock);
    return context;
}

async function test_multiday_1() {
    // this is a test for daily distributions only, none of the other features are tested
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
    let result;

    let days_parameters_arr = [
        { comptokens_minted: 10_000n, },
        { comptokens_minted: 0n, },
        { comptokens_minted: 100n, },
        { comptokens_minted: 1_000_000n, },
    ];

    days_parameters_arr = Array.from({ length: 50 }, (_, i) => { return { comptokens_minted: BigInt(10 ** Math.floor(i / 10)) } });

    let historical_supplies = [];
    let historical_highwatermarks = [];
    try {
        for (let days_parameters of days_parameters_arr) {

            [context, result] = await test_day(context, days_parameters, user_comptoken_token_account.address, testuser);


            const comptoken_mint = await get_account(context, comptoken_mint_pubkey, MintAccount);
            const global_data_account = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
            historical_supplies.push(comptoken_mint.data.supply);
            historical_highwatermarks.push(global_data_account.data.dailyDistributionData.highWaterMark);
            console.log(global_data_account.data);
        }
    } catch (e) {
        throw e;
    } finally {
        for (let [i, days_parameters] of enumerate(days_parameters_arr)) {
            console.log("comptokens minted [%d]: %s", i, days_parameters.comptokens_minted);
        }
        for (let [i, supply] of enumerate(historical_supplies)) {
            console.log("supply[%d]:             %s", i, supply);
        }
        for (let [i, highwatermark] of enumerate(historical_highwatermarks)) {
            console.log("highwatermark[%d]:      %s", i, highwatermark);
        }
        for (let [i, [days_parameters, supply, highwatermark]] of enumerate(zip(days_parameters_arr, historical_supplies, historical_highwatermarks))) {
            console.log("comptokens minted [%d]: %s", i, days_parameters.comptokens_minted);
            console.log("supply[%d]:             %s", i, supply);
            console.log("highwatermark[%d]:      %s", i, highwatermark);
            console.log()
        }
    }
}

/**
 * @param {ProgramTestContext} context 
 * @param {{comptokens_minted: BigInt}} current_day 
 * @returns {[ProgramTestContext, BanksTransactionResultWithMeta]}
 */
async function test_day(context, days_parameters, user_comptoken_token_account_address, testuser) {
    // test_day.* are static variable that are used to persist values across calls to test day
    if (typeof test_day.current_day === 'undefined') {
        test_day.current_day = 1n;
    }
    if (typeof test_day.yesterdays_global_data_account === 'undefined') {
        test_day.yesterdays_global_data_account = get_default_global_data();
    }

    let mint_instructions = [await createTestInstruction(testuser.publicKey, user_comptoken_token_account_address, days_parameters.comptokens_minted)];
    await run_test_quiet("multiday mint " + test_day.current_day, context, mint_instructions, [context.payer, testuser], false, async (context, result) => { });

    console.log("current day: %d, minted %d", test_day.current_day, days_parameters.comptokens_minted);
    advance_to_day(context, test_day.current_day);

    let instructions = [await createDailyDistributionEventInstruction()];
    let result = await run_test_quiet("multiday day " + test_day.current_day, context, instructions, [context.payer], false, async (context, result) => {
        return assert_day(context, result, test_day.yesterdays_global_data_account)
    });

    test_day.yesterdays_global_data_account = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
    test_day.current_day++;

    return result;
}

async function assert_day(context, result, yesterdays_global_data_account) {
    const final_comptoken_mint = await get_account(context, comptoken_mint_pubkey, MintAccount);
    const final_global_data_account = await get_account(context, global_data_account_pubkey, GlobalDataAccount);

    const final_valid_blockhash = final_global_data_account.data.validBlockhashes;
    const yesterdays_valid_blockhash = yesterdays_global_data_account.data.validBlockhashes;
    Assert.assertEqual(
        final_valid_blockhash.announcedBlockhashTime,
        DEFAULT_ANNOUNCE_TIME + (SEC_PER_DAY * test_day.current_day),
        "the announced blockhash time has been updated"
    );
    Assert.assertNotEqual(
        final_valid_blockhash.announcedBlockhash,
        yesterdays_valid_blockhash.announcedBlockhash,
        "announced blockhash has changed"
    ); // TODO: can the actual blockhash be predicted/gotten?
    Assert.assertEqual(
        final_valid_blockhash.validBlockhashTime,
        DEFAULT_DISTRIBUTION_TIME + (SEC_PER_DAY * test_day.current_day),
        "the valid blockhash time has been updated"
    );
    Assert.assertNotEqual(final_valid_blockhash.validBlockhash, yesterdays_valid_blockhash.validBlockhash, "valid blockhash has changed");

    const final_daily_distribution_data = final_global_data_account.data.dailyDistributionData;
    Assert.assertEqual(
        final_daily_distribution_data.lastDailyDistributionTime,
        DEFAULT_DISTRIBUTION_TIME + (SEC_PER_DAY * test_day.current_day),
        "last daily distribution time has updated"
    );
    Assert.assertEqual(
        final_daily_distribution_data.yesterdaySupply,
        final_comptoken_mint.data.supply,
        "yesterdays supply is where the mint is after"
    );
    Assert.assertEqual(
        final_daily_distribution_data.oldestHistoricValue,
        test_day.current_day,
        "oldest interests has increased"
    );
}

(async () => { await test_multiday_1(); })();


function* enumerate(iterable) {
    let i = 0;
    for (const x of iterable) {
        yield [i, x];
        i++;
    }
}

/**
 * @param  {...Iterable} iterables 
 */
function* zip(...iterables) {
    let iterators = iterables.map(it => it[Symbol.iterator]());
    while (true) {
        let result = [];
        for (let it of iterators) {
            let next = it.next();
            if (next.done) {
                return;
            }
            result.push(next.value);
        }
        yield result;
    }
}