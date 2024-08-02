import { SYSVAR_SLOT_HASHES_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import { get_default_comptoken_mint, get_default_global_data } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, DEFAULT_START_TIME, global_data_account_pubkey, Instruction } from "../common.js";

async function test_getValidBlockhashes() {
    let globalData = get_default_global_data();

    const context = await start(
        [{ name: "comptoken", programId: compto_program_id_pubkey }],
        [
            get_default_comptoken_mint().toAccount(),
            globalData.toAccount(),
        ]
    );

    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;
    const rent = await client.getRent();
    const keys = [
        // stores valid blockhashes, but may be out of date
        { pubkey: global_data_account_pubkey, isSigner: false, isWritable: true },
        // program will pull a recent hash from slothashes sysvar if a new valid blockhash is needed.  
        { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
    ];

    const ixs = [new TransactionInstruction({ programId: compto_program_id_pubkey, keys, data: Buffer.from([Instruction.GET_VALID_BLOCKHASHES]) })];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.sign(payer);
    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME));
    const meta = await client.processTransaction(tx);
    const validBlockHashes = { current_block: meta.returnData.data.slice(0, 32), announced_block: meta.returnData.data.slice(32, 64), };
    Assert.assert(validBlockHashes.announced_block.every((v, i) => v === globalData.validBlockhashes.announcedBlockhash[i]), "announced blockhash is globalData default");
    Assert.assert(validBlockHashes.current_block.every((v, i) => v === globalData.validBlockhashes.validBlockhash[i]), "valid blockhash is globalData default");
}

(async () => { await test_getValidBlockhashes(); })();