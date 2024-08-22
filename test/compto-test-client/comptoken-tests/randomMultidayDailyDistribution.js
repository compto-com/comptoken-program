import { Keypair, PublicKey } from "@solana/web3.js";
import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_unpaid_interest_bank,
    get_default_unpaid_verified_human_ubi_bank,
} from "../accounts.js";
import { DaysParameters, generic_daily_distribution_assertions, run_multiday_test, setup_test, YesterdaysAccounts } from "../generic_test.js";
import { createDailyDistributionEventInstruction, createTestInstruction } from "../instruction.js";
import { debug } from "../parse_args.js";
import { clamp, take } from "../utils.js";

class RandomMultidayDailyDistributionDaysParameters extends DaysParameters {
    static yesterdays_accounts = new YesterdaysAccounts();

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
        const yesterdays_accounts = RandomMultidayDailyDistributionDaysParameters.yesterdays_accounts;
        await generic_daily_distribution_assertions(context, result, yesterdays_accounts, this.day, this.comptokens_minted, 0n, 0n);

        RandomMultidayDailyDistributionDaysParameters.yesterdays_accounts = await YesterdaysAccounts.get_accounts(context);
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
    return [...take(length, random_walk_generator(max_step, min, max, bias, start))];
}

function* random_walk_generator(max_step, min, max, bias, start) {
    let current = start;
    while (true) {
        let step = Math.floor(rng() * (max_step * 2 + bias)) - max_step;
        current += step;
        current = clamp(min, current, max);
        yield current;
    }
}

/**
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