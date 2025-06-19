import { ComptokenProof, createProofSubmissionInstruction, TokenAccount, UserDataAccount } from "@compto/comptoken.js";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_global_data,
    get_default_user_data_account,
    MintAccount,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_public_keys, MINING_AMOUNT } from "../common.js";
//import { ComptokenProof } from "../comptoken_proof.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { isArrayEqual } from "../utils.js";

async function test_proofSubmission() {
    const user = Keypair.generate();

    const original_comptoken_mint = get_default_comptoken_mint();
    const original_global_data_account = get_default_global_data();
    const original_user_comptoken_wallet = get_default_comptoken_token_account(PublicKey.unique(), user.publicKey);
    const user_data_pda = PublicKey.findProgramAddressSync([original_user_comptoken_wallet.address.toBytes()], compto_public_keys.compto_program_id_pubkey)[0];
    const original_user_data_account = get_default_user_data_account(user_data_pda);

    const accounts = [original_comptoken_mint, original_global_data_account, original_user_comptoken_wallet, original_user_data_account];

    let context = await setup_test(accounts);

    console.log("after setup_test");

    let proof = ComptokenProof.mine({ // hidden method on ComptokenProof
        pubkey: original_user_comptoken_wallet.address,
        recentBlockHash: original_global_data_account.data.validBlockhashes.validBlockhash,
        extraData: Uint8Array.from(Buffer.from("b8a2f83df38bcca119cc6e82b0043f23370e07406b0676823e60690b48817ee2", "hex")),
        version: 536870912,
        timestamp: Date.now() / 1000, // pubkey and recentBlockHash already introduce entropy between tests, so we don't need to hardcode a time
    });

    let instructions = [await createProofSubmissionInstruction(proof, user.publicKey, original_user_comptoken_wallet.address, compto_public_keys)];
    console.log(`instruction programId: ${instructions[0].programId}`)

    context = await run_test("proofSubmission", context, instructions, [context.payer, user], false, async (context, result) => {
        const final_comptoken_mint_account = await get_account(context, original_comptoken_mint.address, MintAccount);
        Assert.assert(final_comptoken_mint_account.data.supply > original_comptoken_mint.data.supply, "comptokens have been minted");

        const final_user_comptoken_wallet = await get_account(context, original_user_comptoken_wallet.address, TokenAccount);
        Assert.assertEqual(
            final_user_comptoken_wallet.data.amount, original_user_comptoken_wallet.data.amount + MINING_AMOUNT,
            "destination wallet has gained some comptokens"
        );

        const final_user_data_account = await get_account(context, original_user_data_account.address, UserDataAccount);
        Assert.assert(
            isArrayEqual(final_user_data_account.data.recentBlockhash, original_global_data_account.data.validBlockhashes.validBlockhash),
            `user datas recent blockhash is the valid blockhash` +
            `\n    expected: ${Buffer.from(original_global_data_account.data.validBlockhashes.validBlockhash).toString("hex")}` +
            `\n    actual:   ${Buffer.from(final_user_data_account.data.recentBlockhash).toString("hex")}`

        );
        Assert.assertEqual(
            final_user_data_account.data.length, original_user_data_account.data.length + 1n, "user data has stored a proof"
        );
        Assert.assert(isArrayEqual(final_user_data_account.data.proofs[0], proof.hash), "user data has stored the proof submitted");
    });
}

(async () => { await test_proofSubmission(); })();
