import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import {
    get_default_comptoken_mint,
    get_default_comptoken_wallet,
    get_default_global_data,
    get_default_user_data_account,
    MintAccount,
    TokenAccount,
    UserDataAccount,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, DEFAULT_START_TIME, testuser_comptoken_wallet_pubkey } from "../common.js";
import { ComptokenProof } from "../comptoken_proof.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createProofSubmissionInstruction, Instruction } from "../instruction.js";
import { isArrayEqual } from "../utils.js";

async function test_proofSubmission() {
    const testuser = Keypair.generate();

    const comptoken_mint = get_default_comptoken_mint();
    const global_data_account = get_default_global_data();
    const user_comptoken_wallet = get_default_comptoken_wallet(testuser_comptoken_wallet_pubkey, testuser.publicKey);
    const user_data_pda = PublicKey.findProgramAddressSync([user_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    const user_data_account = get_default_user_data_account(user_data_pda);
    const accounts = [
        comptoken_mint,
        global_data_account,
        user_comptoken_wallet,
        user_data_account,
    ]

    let context = await setup_test(accounts);

    let proof = new ComptokenProof(user_comptoken_wallet.address, global_data_account.data.validBlockhashes.validBlockhash);
    proof.mine();

    let instructions = [await createProofSubmissionInstruction(proof, testuser.publicKey, user_comptoken_wallet.address)];
    let result;

    [context, result] = await run_test("proofSubmission", context, instructions, [context.payer, testuser], async (context, result) => {
        const finalMintAccount = await get_account(context, comptoken_mint.address, MintAccount);
        Assert.assert(finalMintAccount.data.supply > comptoken_mint.data.supply, "comptokens have been minted");


        const finalDestinationComptokenWallet = await get_account(context, user_comptoken_wallet.address, TokenAccount);
        Assert.assert(finalDestinationComptokenWallet.data.amount > user_comptoken_wallet.data.amount, "destination wallet has gained some comptokens");

        const finalUserDataAccount = await get_account(context, user_data_account.address, UserDataAccount);
        Assert.assert(isArrayEqual(finalUserDataAccount.data.recentBlockhash, global_data_account.data.validBlockhashes.validBlockhash), "user datas recent blockhash is the valid blockhash");
        Assert.assertEqual(finalUserDataAccount.data.length, user_data_account.data.length + 1n, "user data has stored a proof");
        Assert.assert(isArrayEqual(finalUserDataAccount.data.proofs[0], proof.hash), "user data has stored the proof submitted");
    });
}

(async () => { await test_proofSubmission(); })();
