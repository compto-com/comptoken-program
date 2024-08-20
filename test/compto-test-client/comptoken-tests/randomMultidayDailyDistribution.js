import { Keypair, PublicKey } from "@solana/web3.js";
import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_unpaid_interest_bank,
    get_default_unpaid_verified_human_ubi_bank,
    GlobalDataAccount,
    TokenAccount,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { future_ubi_bank_account_pubkey, global_data_account_pubkey, interest_bank_account_pubkey, verified_human_ubi_bank_account_pubkey } from "../common.js";
import { DaysParameters, Distribution, generic_daily_distribution_assertions, get_account, run_multiday_test, setup_test } from "../generic_test.js";
import { createDailyDistributionEventInstruction, createTestInstruction } from "../instruction.js";
import { debug } from "../parse_args.js";

class RandomMultidayDailyDistributionDaysParameters extends DaysParameters {
    static yesterdays_accounts = {
        global_data_account: get_default_global_data(),
        unpaid_interest_bank: get_default_unpaid_interest_bank(),
        unpaid_verified_human_ubi_bank: get_default_unpaid_verified_human_ubi_bank(),
        unpaid_future_ubi_bank: get_default_unpaid_future_ubi_bank(),
    };

    testuser;
    payer;
    user_comptoken_token_account_address;
    comptokens_minted;

    constructor(day, testuser, payer, user_comptoken_token_account_address, comptokens_minted) {
        super(day);
        this.testuser = testuser;
        this.payer = payer;
        this.user_comptoken_token_account_address = user_comptoken_token_account_address;
        this.comptokens_minted = BigInt(comptokens_minted);
    }

    assert_fn = async (context, result) => {
        await generic_daily_distribution_assertions(context, result, RandomMultidayDailyDistributionDaysParameters.yesterdays_accounts, this.day, this.comptokens_minted);

        const current_global_data_account = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
        const current_unpaid_interest_bank = await get_account(context, interest_bank_account_pubkey, TokenAccount);
        const current_unpaid_verified_human_ubi_bank = await get_account(context, verified_human_ubi_bank_account_pubkey, TokenAccount);
        const current_unpaid_future_ubi_bank = await get_account(context, future_ubi_bank_account_pubkey, TokenAccount);

        const current_highwatermark = current_global_data_account.data.dailyDistributionData.highWaterMark;
        const yesterdays_highwatermark = RandomMultidayDailyDistributionDaysParameters.yesterdays_accounts.global_data_account.data.dailyDistributionData.highWaterMark;
        const highwatermark_increase = current_highwatermark - yesterdays_highwatermark;

        const distribution = new Distribution(current_global_data_account.data.dailyDistributionData, highwatermark_increase, RandomMultidayDailyDistributionDaysParameters.yesterdays_accounts.unpaid_future_ubi_bank.data.amount);

        Assert.assertEqual(
            RandomMultidayDailyDistributionDaysParameters.yesterdays_accounts.unpaid_interest_bank.data.amount + distribution.interest,
            current_unpaid_interest_bank.data.amount,
            "unpaid interest bank should increase by interest_distribution"
        );

        Assert.assertEqual(
            RandomMultidayDailyDistributionDaysParameters.yesterdays_accounts.unpaid_verified_human_ubi_bank.data.amount + distribution.verified_human_ubi,
            current_unpaid_verified_human_ubi_bank.data.amount,
            "unpaid verified human ubi bank should increase by verified_human_ubi"
        );

        Assert.assertEqual(
            RandomMultidayDailyDistributionDaysParameters.yesterdays_accounts.unpaid_future_ubi_bank.data.amount + distribution.future_ubi,
            current_unpaid_future_ubi_bank.data.amount,
            "unpaid future ubi bank should increase by future_ubi"
        );

        RandomMultidayDailyDistributionDaysParameters.yesterdays_accounts = {
            global_data_account: current_global_data_account,
            unpaid_interest_bank: current_unpaid_interest_bank,
            unpaid_verified_human_ubi_bank: current_unpaid_verified_human_ubi_bank,
            unpaid_future_ubi_bank: current_unpaid_future_ubi_bank,
        }
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
}

async function test_multidayDailyDistribution() {
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

    let random_walk = generate_random_walk(100, 5, 0, Infinity, 1);

    debug(random_walk);
    log_random_walk_stats(random_walk);

    let days_parameters_arr = Array.from(random_walk, (v, i) => {
        return new RandomMultidayDailyDistributionDaysParameters(i + 1, testuser, context.payer, user_comptoken_token_account.address, v);
    });

    await run_multiday_test("multiday_daily_distribution_1", context, days_parameters_arr);
}

(async () => { await test_multidayDailyDistribution(); })();

function generate_random_walk(length, max_step = 1, min = -Infinity, max = Infinity, bias = 0, start = 0) {
    let arr = new Array(length);
    let current = start;
    for (let i = 0; i < length; ++i) {
        let step = Math.floor(rng() * (max_step * 2 + bias)) - max_step;
        current += step;
        current = Math.max(Math.min(current, max), min);
        arr[i] = current;
    }
    return arr;
}

/**
 * 
 * @param {number[]} random_walk 
 */
function log_random_walk_stats(random_walk) {
    random_walk = random_walk.slice(); // copy array
    random_walk.sort();
    const min = random_walk[0];
    const max = random_walk[random_walk.length - 1];
    const avg = random_walk.reduce((sum, elem, i) => sum + elem) / random_walk.length;
    const median = random_walk[Math.floor(random_walk.length / 2)];
    debug("min: ", min);
    debug("max: ", max);
    debug("avg: ", avg);
    debug("median: ", median);
}

// from https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript/47593316#47593316
function sfc32(a, b, c, d) {
    return function () {
        a |= 0; b |= 0; c |= 0; d |= 0;
        let t = (a + b | 0) + d | 0;
        d = d + 1 | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = (c << 21 | c >>> 11);
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    }
}

function seedgen() {
    return (Math.random() * 2 ** 32) >>> 0;
}

const seed = [seedgen(), seedgen(), seedgen(), seedgen()];
console.log("seed for rng: ", seed);
const rng = sfc32(seed[0], seed[1], seed[2], seed[3]);