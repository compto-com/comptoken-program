import { Keypair, SystemProgram, TransactionInstruction, } from "@solana/web3.js";

import { ExtraAccountMetaListLayout } from "@solana/spl-token";
import { ExtraAccountMetaAccount, get_default_comptoken_mint, get_default_extra_account_metas_account } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_extra_account_metas_account_pubkey, compto_transfer_hook_id_pubkey, } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { isArrayEqual } from "../utils.js";

async function test_initializeExtraAccountMetaList() {
    const mint_authority = Keypair.generate();
    let comptoken_mint = get_default_comptoken_mint();
    comptoken_mint.data.mintAuthority = mint_authority.publicKey;
    const accounts = [comptoken_mint];

    let context = await setup_test(accounts);

    // solana/web3.js doesn't have a createInitializeExtraAccountMetas function, so we'll create the instruction manually.
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
        { pubkey: context.payer.publicKey, isSigner: true, isWritable: true },
    ];

    // first 8 bytes of sha256 of "spl-transfer-hook-interface:execute"
    // see https://spl.solana.com/transfer-hook-interface/specification
    let instruction_data = Buffer.from([43, 34, 13, 49, 167, 88, 235, 235]);
    let extra_account_meta_list_data = Buffer.alloc(4); // empty ExtraAccountMetaList size
    ExtraAccountMetaListLayout.encode({
        count: 0,
        extraAccounts: [],
    }, extra_account_meta_list_data);
    let data = Buffer.concat([instruction_data, extra_account_meta_list_data]);

    let instructions = [new TransactionInstruction({ programId: compto_transfer_hook_id_pubkey, keys, data })];
    let result;

    [context, result] = await run_test("initializeExtraAccountMetaList", context, instructions, [context.payer, mint_authority], false, async (context, result) => {
        const final_extra_account_meta_list_account = await get_account(context, compto_extra_account_metas_account_pubkey, ExtraAccountMetaAccount);
        const default_account_meta_list = get_default_extra_account_metas_account()
        Assert.assert(final_extra_account_meta_list_account.address.equals(default_account_meta_list.address), "address isn't correct");
        Assert.assertEqual(
            final_extra_account_meta_list_account.data.extraAccountsList.length,
            default_account_meta_list.data.extraAccountsList.length,
            "length isn't correct");
        let zipped = final_extra_account_meta_list_account.data.extraAccountsList.extraAccounts.map(
            (v, i) => [v, default_account_meta_list.data.extraAccountsList.extraAccounts[i]]
        );
        for (const [final, oracle] of zipped) {
            Assert.assertEqual(final.discriminator, oracle.discriminator, "discriminators aren't the same");
            Assert.assertEqual(final.isSigner, oracle.isSigner, "isSigner isn't the same");
            Assert.assertEqual(final.isWritable, oracle.isWritable, "isWritable isn't the same");
            Assert.assert(isArrayEqual(final.addressConfig, oracle.addressConfig), "address configs aren't the same");
        }
    });
}

(async () => { await test_initializeExtraAccountMetaList(); })();