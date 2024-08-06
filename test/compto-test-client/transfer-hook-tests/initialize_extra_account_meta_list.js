import { Keypair, SystemProgram, Transaction, TransactionInstruction, } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import { ExtraAccountMetaAccount, get_default_comptoken_mint, get_default_extra_account_metas_account } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_extra_account_metas_account_pubkey, compto_transfer_hook_id_pubkey, DEFAULT_START_TIME, } from "../common.js";

async function test_initializeExtraAccountMetaList() {
    let comptoken_mint = get_default_comptoken_mint();
    const mint_authority = Keypair.generate();
    comptoken_mint.mintAuthority = mint_authority.publicKey;

    const context = await start(
        [{ name: "comptoken_transfer_hook", programId: compto_transfer_hook_id_pubkey }],
        [
            comptoken_mint.toAccount(),
        ]
    );

    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;

    const keys = [
        // the account that stores the extra account metas
        { pubkey: compto_extra_account_metas_account_pubkey, isSigner: false, isWritable: true },
        // the mint account associated with the transfer hook
        { pubkey: comptoken_mint.address, isSigner: false, isWritable: true },
        // the mint authority for the mint
        { pubkey: mint_authority.publicKey, isSigner: true, isWritable: false },
        // system account is used to create the account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        // the account who pays for the creation
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    ];

    // first 8 bytes of sha256 of "spl-transfer-hook-interface:execute"
    // see https://spl.solana.com/transfer-hook-interface/specification
    let instruction_data = Buffer.from([43, 34, 13, 49, 167, 88, 235, 235]);
    let empty_account_meta_data = Buffer.from([0, 0, 0, 0]);
    let data = Buffer.concat([instruction_data, empty_account_meta_data]);

    const ixs = [new TransactionInstruction({ programId: compto_transfer_hook_id_pubkey, keys, data })];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.sign(payer, mint_authority);
    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME));
    const meta = await client.processTransaction(tx);

    console.log("logMessages: %s", meta.logMessages);
    console.log("computeUnitsConsumed: %d", meta.computeUnitsConsumed);
    console.log("returnData: %s", meta.returnData);

    let account = await client.getAccount(compto_extra_account_metas_account_pubkey);
    Assert.assertNotNull(account);
    const finalMetaListAccount = ExtraAccountMetaAccount.fromAccountInfoBytes(compto_extra_account_metas_account_pubkey, account);
    // comptoken program id
    const accountMetaList = get_default_extra_account_metas_account()
    Assert.assert(finalMetaListAccount.address.equals(accountMetaList.address), "address isn't correct");
    Assert.assertEqual(finalMetaListAccount.extraAccountMetas.length, accountMetaList.extraAccountMetas.length, "length isn't correct");
    let zipped = finalMetaListAccount.extraAccountMetas.map((v, i) => [v, accountMetaList.extraAccountMetas[i]]);
    for (const [final, oracle] of zipped) {
        Assert.assertEqual(final.discriminator, oracle.discriminator, "discriminators aren't the same");
        Assert.assertEqual(final.isSigner, oracle.isSigner, "isSigner isn't the same");
        Assert.assertEqual(final.isWritable, oracle.isWritable, "isWritable isn't the same");
        Assert.assert(final.addressConfig.reduce((pv, cv, i) => pv && cv === oracle.addressConfig[i], true), "address configs aren't the same");
    }
}

(async () => { await test_initializeExtraAccountMetaList(); })();