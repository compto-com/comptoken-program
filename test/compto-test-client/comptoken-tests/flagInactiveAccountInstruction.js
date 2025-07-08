import {
    createFlagInactiveAccountInstruction,
    GlobalDataAccount,
    UserDataAccount,
} from "@compto/comptoken.js";
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_extra_account_metas_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_user_data_account,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_public_keys, DEFAULT_DISTRIBUTION_TIME } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";

// TODO: tests:
//      flag already inactive account
//      flag account that is not inactive
//      flag unverified account
//      incorrect accounts (e.g. accounts not correctly signed/writable, missing accounts, etc.)

async function test_flagInactiveAccountInstruction() {
    const nullifier_hash = Buffer.from("06e05b30363654d2be77b7b16091735f139f31bc097bb2a1aa9450b96f7df677", "hex");

    const user = Keypair.generate();

    let original_comptoken_mint = get_default_comptoken_mint();
    original_comptoken_mint.data.supply = 1_000_000_000n;

    const original_global_data = get_default_global_data();
    original_global_data.data.dailyDistributionData.verifiedHumans = 1n;
    original_global_data.data.dailyDistributionData.historicDistributions = Array(365).fill({
        interestRate: 1.01,
        ubiAmount: 1n,
    });

    let original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();
    original_unpaid_future_ubi_bank.data.amount = 1_000_000_000n;

    const original_user_comptoken_wallet = get_default_comptoken_token_account(PublicKey.unique(), user.publicKey);
    original_user_comptoken_wallet.data.amount = 100n;

    const user_data_pda = PublicKey.findProgramAddressSync([original_user_comptoken_wallet.address.toBytes()], compto_public_keys.compto_program_id_pubkey)[0];
    let original_user_data_account = get_default_user_data_account(user_data_pda);
    original_user_data_account.data.lastInterestPayoutDate = DEFAULT_DISTRIBUTION_TIME - BigInt(60 * 60 * 24 * 365); // 365 days ago
    original_user_data_account.data.verificationDate = DEFAULT_DISTRIBUTION_TIME;
    original_user_data_account.data.nullifierHash = nullifier_hash;
    original_user_data_account.data.isVerifiedHuman = true;

    const existing_accounts = [
        original_comptoken_mint, original_global_data, original_unpaid_future_ubi_bank, original_user_comptoken_wallet, original_user_data_account,
        get_default_extra_account_metas_account(),
    ];

    let context = await setup_test(existing_accounts);

    const instructions = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        await createFlagInactiveAccountInstruction(
            original_user_comptoken_wallet.address,
            compto_public_keys
        ),
    ];

    context = await run_test("flagInactiveAccount", context, instructions, [context.payer], false, async (context, result) => {
        const inactive_interest = 3416n; // ~ 100 * 1.01^365 - 100 (should be 3678, but rounding errors)
        const inactive_ubi = 365n; // 1 UBI per day for 365 days
        const inactive_ubi_interest = 3453n; // ((100 * 1.01 + 1) * 1.01 + 1) ... 365 times - inactive_interest - inactive_ubi

        const final_user_data_account = await get_account(context, original_user_data_account.address, UserDataAccount);
        Assert.assertEqual(final_user_data_account.data.inactiveInterest, inactive_interest, "inactive interest");
        Assert.assertEqual(final_user_data_account.data.inactiveUbiInterest, inactive_ubi_interest, "inactive UBI interest");
        Assert.assertEqual(final_user_data_account.data.inactiveUbi, inactive_ubi, "inactive UBI");

        const final_global_data_account = await get_account(context, original_global_data.address, GlobalDataAccount);
        Assert.assertEqual(final_global_data_account.data.dailyDistributionData.verifiedHumans, 1n, "verified humans count unchanged");
        Assert.assertEqual(
            final_global_data_account.data.dailyDistributionData.inactiveVerifiedHumans,
            original_global_data.data.dailyDistributionData.inactiveVerifiedHumans + 1n,
            "inactive verified humans count incremented",
        );
        Assert.assertEqual(
            final_global_data_account.data.dailyDistributionData.totalInactiveComptokens,
            original_global_data.data.dailyDistributionData.totalInactiveComptokens + inactive_interest + inactive_ubi_interest + inactive_ubi + original_user_comptoken_wallet.data.amount,
            "total inactive comptokens incremented",
        );
    });
}

(async () => { await test_flagInactiveAccountInstruction(); })();