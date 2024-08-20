import { format } from "node:util";

import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BanksTransactionResultWithMeta, Clock, ProgramTestContext, start } from "solana-bankrun";

import { Account, GlobalDataAccount, MintAccount } from "./accounts.js";
import { Assert, AssertionError } from "./assert.js";
import {
    compto_program_id_pubkey,
    compto_transfer_hook_id_pubkey,
    COMPTOKEN_DISTRIBUTION_MULTIPLIER,
    comptoken_mint_pubkey,
    DEFAULT_ANNOUNCE_TIME,
    DEFAULT_DISTRIBUTION_TIME,
    DEFAULT_START_TIME,
    FUTURE_UBI_VERIFIED_HUMANS,
    global_data_account_pubkey,
    SEC_PER_DAY,
} from "./common.js";
import { debug, info, log, print } from "./parse_args.js";
import { enumerate } from "./utils.js";

export class DaysParameters {
    day;
    should_fail = false;

    /**
     * @param {ProgramTestContext} context 
     * @param {BanksTransactionResultWithMeta} result 
     */
    assert_fn = async (context, result) => { notImplemented() };;

    constructor(day, should_fail = false, assert_fn = undefined) {
        this.day = BigInt(day);
        this.should_fail = should_fail;
        if (assert_fn !== undefined) {
            this.assert_fn = assert_fn;
        }

        if (this.constructor === DaysParameters) {
            throw new TypeError("Abstract class 'DaysParameters' cannot be instantiated directly.");
        }
        if (this.assert_fn === notImplemented) {
            throw new TypeError("Classes extending the DaysParameters abstract class must implement assert_fn, or pass it in the constructor");
        }
        if (this.get_setup_instructions === notImplemented) {
            throw new TypeError("Classes extending the DaysParameters abstract class must implement get_setup_instructions");
        }
        if (this.get_setup_signers === notImplemented) {
            throw new TypeError("Classes extending the DaysParameters abstract class must implement get_setup_signers");
        }
        if (this.get_instructions === notImplemented) {
            throw new TypeError("Classes extending the DaysParameters abstract class must implement get_instructions");
        }
        if (this.get_signers === notImplemented) {
            throw new TypeError("Classes extending the DaysParameters abstract class must implement get_signers");
        }
    }

    async get_setup_instructions() { notImplemented() };
    async get_setup_signers() { notImplemented() };
    async get_instructions() { notImplemented() };
    async get_signers() { notImplemented() };

    /**
     * @param {string} name 
     * @param {ProgramTestContext} context 
     * @returns {ProgramTestContext}
     */
    async setup_day(name, context, test_number) {
        let day = this.day;
        name = format("setup %s multiday test %d (day %d)", name, test_number, day);

        let instructions = await this.get_setup_instructions();
        let signers = await this.get_setup_signers();

        context = await run_test(name, context, instructions, signers, false, (context, result) => { });

        context = advance_to_day(context, day);
        return context;
    }

    /**
     * @param {string} name 
     * @param {ProgramTestContext} context 
     * @returns {ProgramTestContext}
     */
    async run_test(name, context, test_number) {
        name = format("run %s multiday test %d (day %d)", name, test_number, this.day);

        let instructions = await this.get_instructions();
        let signers = await this.get_signers();

        return await run_test(name, context, instructions, signers, this.should_fail, this.assert_fn);
    }
}

/**
 * @param {string} name 
 * @param {ProgramTestContext} context
 * @param {TransactionInstruction[]} instructions
 * @param {Keypair[]} signers
 * @param {boolean} should_fail
 * @param {boolean} args
 * @param {(ProgramTestContext, BanksTransactionResultWithMeta) => null} assert_fn 
 * @returns {ProgramTestContext}
 */
export async function run_test(name, context, instructions, signers, should_fail, assert_fn) {
    print("test " + name);
    debug(context);
    debug(instructions);
    debug(signers);

    const client = context.banksClient;
    const payer = context.payer;

    const tx = new Transaction();
    [tx.recentBlockhash,] = await client.getLatestBlockhash();
    tx.add(...instructions);
    tx.feePayer = payer.publicKey;
    tx.sign(payer, ...signers);

    const result = await client.tryProcessTransaction(tx);

    debug("result: %s", result.result);
    if (result.meta !== null) {
        log("logMessages: %s", result.meta.logMessages);
        debug("computeUnitsConsumed: %d", result.meta.computeUnitsConsumed);
        debug("returnData: %s", result.meta.returnData);
    }

    debug("should_fail: %s", should_fail);
    if (should_fail) {
        Assert.assertNotNull(result.result, "transaction should have failed");
    } else {
        Assert.assert(result.result === null, "transaction should have succeeded");
    }


    await assert_fn(context, result);

    print("test %s passed", name);
    return context;
}

/**
 * @param {string} name 
 * @param {ProgramTestContext} context 
 * @param {DaysParameters[]} days_parameters_arr 
 */
export async function run_multiday_test(name, context, days_parameters_arr) {
    for (let { index: test_number, value: days_parameters } of enumerate(days_parameters_arr)) {
        console.log(days_parameters);
        context = await days_parameters.setup_day(name, context, test_number);
        try {
            context = await days_parameters.run_test(name, context, test_number);
        } catch (error) {
            if (error instanceof AssertionError) {
                error.addNote("test number: " + test_number)
                    .addNote("current day: " + days_parameters.day);
            }
            throw error;
        }

    }
}

export async function generic_daily_distribution_assertions(context, result, yesterdays_accounts, day, comptokens_minted) {
    comptokens_minted = BigInt(comptokens_minted);
    day = BigInt(day);

    const current_comptoken_mint = await get_account(context, comptoken_mint_pubkey, MintAccount);
    const current_global_data_account = await get_account(context, global_data_account_pubkey, GlobalDataAccount);

    const current_valid_blockhash = current_global_data_account.data.validBlockhashes;
    const yesterdays_valid_blockhash = yesterdays_accounts.global_data_account.data.validBlockhashes;
    Assert.assertEqual(
        current_valid_blockhash.announcedBlockhashTime,
        DEFAULT_ANNOUNCE_TIME + (SEC_PER_DAY * day),
        "the announced blockhash time has been updated"
    );
    Assert.assertNotEqual(
        current_valid_blockhash.announcedBlockhash,
        yesterdays_valid_blockhash.announcedBlockhash,
        "announced blockhash has changed"
    ); // TODO: can the actual blockhash be predicted/gotten?
    Assert.assertEqual(
        current_valid_blockhash.validBlockhashTime,
        DEFAULT_DISTRIBUTION_TIME + (SEC_PER_DAY * day),
        "the valid blockhash time has been updated"
    );
    Assert.assertNotEqual(current_valid_blockhash.validBlockhash, yesterdays_valid_blockhash.validBlockhash, "valid blockhash has changed");

    const current_daily_distribution_data = current_global_data_account.data.dailyDistributionData;
    Assert.assertEqual(
        current_daily_distribution_data.lastDailyDistributionTime,
        DEFAULT_DISTRIBUTION_TIME + (SEC_PER_DAY * day),
        "last daily distribution time has updated"
    );
    Assert.assertEqual(
        current_daily_distribution_data.yesterdaySupply,
        current_comptoken_mint.data.supply,
        "yesterdays supply is where the mint is after"
    );
    Assert.assertEqual(
        current_daily_distribution_data.oldestHistoricValue,
        day % 365n,
        "oldestHistoricValue is updated"
    );

    // yesterdaySupply stores the supply at the start of the day, which is right now.
    const current_supply = current_daily_distribution_data.yesterdaySupply;
    const yesterdays_supply = yesterdays_accounts.global_data_account.data.dailyDistributionData.yesterdaySupply;
    const supply_increase = current_supply - yesterdays_supply;

    const current_highwatermark = current_global_data_account.data.dailyDistributionData.highWaterMark;
    const yesterdays_highwatermark = yesterdays_accounts.global_data_account.data.dailyDistributionData.highWaterMark;
    const highwatermark_increase = current_highwatermark - yesterdays_highwatermark;

    const distribution = new Distribution(current_daily_distribution_data, highwatermark_increase, yesterdays_accounts.unpaid_future_ubi_bank.data.amount);

    debug("distribution: %d", distribution.total());

    Assert.assertEqual(
        supply_increase,
        comptokens_minted + distribution.total(),
        "supply should increase by comptokens_minted yesterday + high_watermark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER"
    );
}

export class Distribution {
    interest;
    future_ubi;
    verified_human_ubi;

    constructor(daily_distribution_data, high_watermark_increase, unpaid_future_ubi_amount) {

        daily_distribution_data.historicDistributions.forEach(element => {
            info("interestRate: %f", element.interestRate);
        });
        const verified_humans = Number(daily_distribution_data.verifiedHumans);
        const interest_rate = daily_distribution_data.historicDistributions[daily_distribution_data.oldestHistoricValue - 1n].interestRate - 1;
        debug("interest_rate: %f", interest_rate);

        const original_distribution = high_watermark_increase * COMPTOKEN_DISTRIBUTION_MULTIPLIER;
        debug("original_distribution: %d", original_distribution);
        let interest_distribution = original_distribution / 2n;
        debug("interest_distribution before UBI Interest: %d", interest_distribution);
        const ubi_distribution = original_distribution / 2n;
        debug("ubi_distribution before UBI Interest: %d", ubi_distribution);

        const unchecked_verified_human_proportion = 2 * verified_humans / (FUTURE_UBI_VERIFIED_HUMANS + verified_humans);
        const verified_human_proportion = Math.min(unchecked_verified_human_proportion, 1);
        debug("verified_human_proportion: %f", verified_human_proportion);
        const verified_human_ubi_distribution = BigInt(Number(ubi_distribution) * verified_human_proportion);
        debug("verified_human_ubi before UBI Interest: %d", verified_human_ubi_distribution);
        let future_ubi_distribution = ubi_distribution - verified_human_ubi_distribution;
        debug("future_ubi before UBI Interest: %d", future_ubi_distribution);

        let future_ubi_interest = BigInt(round_ties_even(Number(unpaid_future_ubi_amount) * interest_rate));
        future_ubi_distribution += future_ubi_interest;
        interest_distribution -= future_ubi_interest;

        debug("interest_distribution: %d", interest_distribution);
        debug("ubi_distribution: %d", ubi_distribution + future_ubi_interest);
        debug("verified_human_ubi: %d", verified_human_ubi_distribution);
        debug("future_ubi: %d", future_ubi_distribution);


        this.interest = interest_distribution;
        this.future_ubi = future_ubi_distribution;
        this.verified_human_ubi = verified_human_ubi_distribution;
    }

    total() {
        return this.interest + this.future_ubi + this.verified_human_ubi;
    }
}

function round_ties_even(number) {
    const result = Math.round(number);
    const fract = Math.abs(number - result);
    if (float_equals(fract, 0.5) && result % 2 !== 0) {
        return Math.trunc(number);
    } else {
        return result;
    }
}

function float_equals(a, b) {
    const epsilon = 1e-10; // what copilot autofilled
    return a < b + epsilon && a > b - epsilon;
}

/**
 * @param {Account[]} existing_accounts 
 * @param {Clock} clock
 * @returns {ProgramTestContext}
 */
export async function setup_test(existing_accounts, clock = new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME)) {
    let context = await start(
        [
            { name: "comptoken", programId: compto_program_id_pubkey },
            { name: "comptoken_transfer_hook", programId: compto_transfer_hook_id_pubkey },
        ],
        existing_accounts.map((account, i) => account.toAddedAccount()),
    );
    context.setClock(clock);

    return context;
}

/**
 * @param {ProgramTestContext} context 
 * @param {PublicKey} account_address 
 * @param {typeof Account} account_type
 * @returns 
 */
export async function get_account(context, account_address, account_type) {
    let account = await context.banksClient.getAccount(account_address);
    Assert.assertNotNull(account);
    return account_type.fromAccountInfoBytes(account_address, account);
}

/**
 * @param {ProgramTestContext} context
 * @param {BigInt} new_day
 */
function advance_to_day(context, new_day) {
    const SLOTS_PER_DAY = 216_000n; // roughly a days worth of slots
    const current_slot = SLOTS_PER_DAY * BigInt(new_day);
    let new_clock = new Clock(current_slot, 0n, 0n, 0n, DEFAULT_START_TIME + (SEC_PER_DAY * BigInt(new_day)));
    context.setClock(new_clock);
    return context;
}

function notImplemented() { throw new Error("Not Implemented"); }