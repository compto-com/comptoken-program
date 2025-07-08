import {
    createUnverifyHumanInstruction,
    GlobalDataAccount,
    TokenAccount,
    UserDataAccount,
} from "@compto/comptoken.js";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_extra_account_metas_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_user_data_account,
    Nullifier,
    NullifierAccount,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_public_keys, DEFAULT_DISTRIBUTION_TIME } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";

async function test_unverifyHumanInstruction() {
    const nullifier_hash = Buffer.from("06e05b30363654d2be77b7b16091735f139f31bc097bb2a1aa9450b96f7df677", "hex");

    const user = Keypair.fromSeed(new Uint8Array(32).fill(0x01));

    let original_comptoken_mint = get_default_comptoken_mint();
    original_comptoken_mint.data.supply = 1_000_000_000n;

    const original_global_data = get_default_global_data();
    original_global_data.data.dailyDistributionData.verifiedHumans = 1n;

    let original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();
    original_unpaid_future_ubi_bank.data.amount = 1_000_000_000n;

    const original_user_comptoken_wallet = get_default_comptoken_token_account(new PublicKey(Buffer.from("8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c", "hex")), user.publicKey);

    const user_data_pda = PublicKey.findProgramAddressSync([original_user_comptoken_wallet.address.toBytes()], compto_public_keys.compto_program_id_pubkey)[0];
    let original_user_data_account = get_default_user_data_account(user_data_pda);
    original_user_data_account.data.verificationDate = DEFAULT_DISTRIBUTION_TIME;
    original_user_data_account.data.nullifierHash = nullifier_hash;

    const nullifier_account = new NullifierAccount(
        PublicKey.findProgramAddressSync([Buffer.from("Nullifier"), nullifier_hash], compto_public_keys.compto_program_id_pubkey)[0],
        10_000n,
        compto_public_keys.compto_program_id_pubkey,
        new Nullifier({
            account: user_data_pda,
        }),
    );

    const existing_accounts = [
        original_comptoken_mint, original_global_data, original_unpaid_future_ubi_bank, original_user_comptoken_wallet, original_user_data_account,
        get_default_extra_account_metas_account(), nullifier_account
    ];

    let context = await setup_test(existing_accounts);

    const instructions = [
        await createUnverifyHumanInstruction(
            user.publicKey,
            original_user_comptoken_wallet.address,
            nullifier_hash,
            compto_public_keys
        ),
    ];

    context = await run_test("UnverifyHuman", context, instructions, [context.payer, user], false, async (context, result) => {
        const final_user_data_account = await get_account(context, user_data_pda, UserDataAccount);
        Assert.assertEqual(final_user_data_account.data.verificationDate, 0n, "user data verificationDate");
        Assert.assertEqual("0000000000000000000000000000000000000000000000000000000000000000", final_user_data_account.data.nullifierHash.toString('hex'), "nullifier PDA address");

        const final_user_comptoken_wallet = await get_account(context, original_user_comptoken_wallet.address, TokenAccount);

        Assert.assertEqual(final_user_comptoken_wallet.data.amount, original_user_comptoken_wallet.data.amount, "user comptoken wallet amount");

        const final_global_data = await get_account(context, original_global_data.address, GlobalDataAccount);
        // unverifyHuman increase inactiveVerifiedHumans rather than decreasing verifiedHumans to prevent double dipping on "future" ubi
        Assert.assertEqual(
            final_global_data.data.dailyDistributionData.verifiedHumans,
            original_global_data.data.dailyDistributionData.verifiedHumans,
            "global data totalVerifiedHumans"
        );
        Assert.assertEqual(
            final_global_data.data.dailyDistributionData.inactiveVerifiedHumans,
            original_global_data.data.dailyDistributionData.inactiveVerifiedHumans + 1n,
            "global data totalInactiveVerifiedHumans"
        );


        const nullifier_pda = PublicKey.findProgramAddressSync([Buffer.from("Nullifier"), nullifier_hash], compto_public_keys.compto_program_id_pubkey)[0];
        const final_nullifier_account = await get_account(context, nullifier_pda, NullifierAccount);
        Assert.assertEqual(final_nullifier_account.data.account.toBase58(), PublicKey.default.toBase58(), "nullifier account");
    });
}

(async () => { await test_unverifyHumanInstruction(); })();