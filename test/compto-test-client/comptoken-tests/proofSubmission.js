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
import { Instruction } from "../instruction.js";
import { isArrayEqual } from "../utils.js";

async function test_proofSubmission() {
    const testuser = Keypair.generate();
    let global_data_account = get_default_global_data();
    let mint_account = get_default_comptoken_mint();
    let destination_comptoken_wallet = get_default_comptoken_wallet(testuser_comptoken_wallet_pubkey, testuser.publicKey);
    const user_data_pda = PublicKey.findProgramAddressSync([destination_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    let user_data_account = get_default_user_data_account(user_data_pda);

    const context = await start(
        [{ name: "comptoken", programId: compto_program_id_pubkey }],
        [
            mint_account.toAccount(),
            global_data_account.toAccount(),
            destination_comptoken_wallet.toAccount(),
            user_data_account.toAccount(),
        ]
    );

    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;
    const keys = [
        // will mint some comptokens
        { pubkey: mint_account.address, isSigner: false, isWritable: true },
        // will store minted comptoken
        { pubkey: destination_comptoken_wallet.address, isSigner: false, isWritable: true },
        // stores the current valid blockhashes
        { pubkey: global_data_account.address, isSigner: false, isWritable: false },
        // stores the proof to prevent duplicate submissions
        { pubkey: user_data_account.address, isSigner: false, isWritable: true },
        // for the actual minting
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        // the owner of the comptoken wallet
        { pubkey: testuser.publicKey, isSigner: true, isWritable: false },
    ];

    let proof = new ComptokenProof(destination_comptoken_wallet.address, global_data_account.data.validBlockhashes.validBlockhash);
    proof.mine();
    let data = Buffer.concat([
        Buffer.from([Instruction.PROOF_SUBMISSION]),
        proof.serializeData(),
    ]);

    const ixs = [new TransactionInstruction({ programId: compto_program_id_pubkey, keys, data })];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.sign(payer, testuser);
    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME));
    const meta = await client.processTransaction(tx);

    let account = await client.getAccount(mint_account.address);
    Assert.assertNotNull(account);
    const finalMintAccount = MintAccount.fromAccountInfoBytes(mint_account.address, account);
    Assert.assert(finalMintAccount.data.supply > mint_account.data.supply, "comptokens have been minted");

    account = await client.getAccount(destination_comptoken_wallet.address);
    Assert.assertNotNull(account);
    const finalDestinationComptokenWallet = TokenAccount.fromAccountInfoBytes(destination_comptoken_wallet.address, account);
    Assert.assert(finalDestinationComptokenWallet.data.amount > destination_comptoken_wallet.data.amount, "destination wallet has gained some comptokens");

    account = await client.getAccount(user_data_account.address);
    Assert.assertNotNull(account);
    const finalUserDataAccount = UserDataAccount.fromAccountInfoBytes(user_data_account.address, account);
    Assert.assert(isArrayEqual(finalUserDataAccount.data.recentBlockhash, global_data_account.data.validBlockhashes.validBlockhash), "user datas recent blockhash is the valid blockhash");
    Assert.assertEqual(finalUserDataAccount.data.length, user_data_account.data.length + 1n, "user data has stored a proof");
    Assert.assert(isArrayEqual(finalUserDataAccount.data.proofs[0], proof.hash), "user data has stored the proof submitted");
}

(async () => { await test_proofSubmission(); })();
