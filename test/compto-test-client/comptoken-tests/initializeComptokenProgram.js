import { AccountState } from "@solana/spl-token";

import { ExtraAccountMetaAccount, get_default_comptoken_mint, get_default_extra_account_metas_account, GlobalDataAccount, TokenAccount } from "../accounts.js";
import { Assert } from "../assert.js";
import {
    compto_extra_account_metas_account_pubkey,
    comptoken_mint_pubkey,
    DEFAULT_ANNOUNCE_TIME,
    DEFAULT_DISTRIBUTION_TIME,
    global_data_account_pubkey,
    interest_bank_account_pubkey,
    ubi_bank_account_pubkey
} from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";
import { createInitializeComptokenProgramInstruction } from "../instruction.js";
import { isArrayEqual } from "../utils.js";

async function initialize_comptoken_program() {
    const accounts = [
        get_default_comptoken_mint(),
    ]

    let context = await setup_test(accounts);

    let instructions = [await createInitializeComptokenProgramInstruction(context)];
    let result;

    [context, result] = await run_test("initializeComptokenProgram", context, instructions, [context.payer], async (context, result) => {
        const finalGlobalData = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
        Assert.assertEqual(finalGlobalData.data.validBlockhashes.announcedBlockhashTime, DEFAULT_ANNOUNCE_TIME, "announced blockhash time");
        Assert.assertEqual(finalGlobalData.data.validBlockhashes.validBlockhashTime, DEFAULT_DISTRIBUTION_TIME, "valid blockhash time");

        const finalInterestBank = await get_account(context, interest_bank_account_pubkey, TokenAccount);
        Assert.assertEqual(finalInterestBank.data.amount, 0n, "interest amount");
        Assert.assert(finalInterestBank.data.mint.equals(comptoken_mint_pubkey), "interest mint");
        Assert.assert(finalInterestBank.data.owner.equals(global_data_account_pubkey), "interest owner");
        Assert.assertEqual(finalInterestBank.data.state, AccountState.Initialized, "interest state");

        const finalUBIBank = await get_account(context, ubi_bank_account_pubkey, TokenAccount);
        Assert.assertEqual(finalUBIBank.data.amount, 0n, "ubi amount");
        Assert.assert(finalUBIBank.data.mint.equals(comptoken_mint_pubkey), "ubi mint");
        Assert.assert(finalUBIBank.data.owner.equals(global_data_account_pubkey), "ubi owner");
        Assert.assertEqual(finalUBIBank.data.state, AccountState.Initialized, "ubi state");

        const finalMetaListAccount = await get_account(context, compto_extra_account_metas_account_pubkey, ExtraAccountMetaAccount);
        // comptoken program id
        const accountMetaList = get_default_extra_account_metas_account()
        Assert.assert(finalMetaListAccount.address.equals(accountMetaList.address), "address isn't correct");
        Assert.assertEqual(finalMetaListAccount.data.extraAccountsList.length, accountMetaList.data.extraAccountsList.length, "length isn't correct");
        let zipped = finalMetaListAccount.data.extraAccountsList.extraAccounts.map((v, i) => [v, accountMetaList.data.extraAccountsList.extraAccounts[i]]);
        for (const [final, oracle] of zipped) {
            Assert.assertEqual(final.discriminator, oracle.discriminator, "discriminators aren't the same");
            Assert.assertEqual(final.isSigner, oracle.isSigner, "isSigner isn't the same");
            Assert.assertEqual(final.isWritable, oracle.isWritable, "isWritable isn't the same");
            Assert.assert(isArrayEqual(final.addressConfig, oracle.addressConfig), "address configs aren't the same");
        }
    });
}

(async () => { await initialize_comptoken_program(); })();
