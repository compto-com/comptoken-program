import { AccountLayout, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, TransactionInstruction, } from "@solana/web3.js";
import { start } from "solana-bankrun";

import { get_default_comptoken_mint, get_default_comptoken_wallet, get_default_global_data } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, comptoken_mint_pubkey, global_data_account_pubkey, Instruction } from "../common.js";

async function test_mint() {
    const user_wallet_before = get_default_comptoken_wallet(PublicKey.unique(), PublicKey.unique());
    const context = await start(
        [{ name: "comptoken", programId: compto_program_id_pubkey }],
        [
            get_default_comptoken_mint().toAccount(),
            get_default_global_data().toAccount(),
            user_wallet_before.toAccount(),
        ]);

    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;
    const keys = [
        // communicates to the token program which mint (and therefore which mint authority)
        // to mint the tokens from
        { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: true },
        // the address to receive the test tokens
        { pubkey: user_wallet_before.address, isSigner: false, isWritable: true },
        // the mint authority that will sign to mint the tokens
        { pubkey: global_data_account_pubkey, isSigner: false, isWritable: false },
        // the token program that will mint the tokens when instructed by the mint authority
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    const ixs = [new TransactionInstruction({ programId: compto_program_id_pubkey, keys, data: Buffer.from([Instruction.TEST]) })];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.sign(payer);
    const meta = await client.processTransaction(tx);
    const rawAccount = await client.getAccount(user_wallet_before.address);
    Assert.assertNotNull(rawAccount);
    const user_wallet_after = AccountLayout.decode(rawAccount?.data);
    Assert.assertEqual(
        user_wallet_before.amount + 2n, // MAGIC NUMBER: ensure it remains consistent with comptoken.rs
        user_wallet_after.amount
    );
}

(async () => { await test_mint(); })();
