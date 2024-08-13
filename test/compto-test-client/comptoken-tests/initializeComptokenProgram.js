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
    const existing_accounts = [get_default_comptoken_mint()];

    let context = await setup_test(existing_accounts);

    let instructions = [await createInitializeComptokenProgramInstruction(context)];
    let result;

    [context, result] = await run_test("initializeComptokenProgram", context, instructions, [context.payer], async (context, result) => {
        const final_global_data = await get_account(context, global_data_account_pubkey, GlobalDataAccount);
        Assert.assertEqual(final_global_data.data.validBlockhashes.announcedBlockhashTime, DEFAULT_ANNOUNCE_TIME, "announced blockhash time");
        Assert.assertEqual(final_global_data.data.validBlockhashes.validBlockhashTime, DEFAULT_DISTRIBUTION_TIME, "valid blockhash time");

        const final_interest_bank = await get_account(context, interest_bank_account_pubkey, TokenAccount);
        Assert.assertEqual(final_interest_bank.data.amount, 0n, "interest amount");
        Assert.assert(final_interest_bank.data.mint.equals(comptoken_mint_pubkey), "interest mint");
        Assert.assert(final_interest_bank.data.owner.equals(global_data_account_pubkey), "interest owner");
        Assert.assertEqual(final_interest_bank.data.state, AccountState.Initialized, "interest state");

        const final_UBI_bank = await get_account(context, ubi_bank_account_pubkey, TokenAccount);
        Assert.assertEqual(final_UBI_bank.data.amount, 0n, "ubi amount");
        Assert.assert(final_UBI_bank.data.mint.equals(comptoken_mint_pubkey), "ubi mint");
        Assert.assert(final_UBI_bank.data.owner.equals(global_data_account_pubkey), "ubi owner");
        Assert.assertEqual(final_UBI_bank.data.state, AccountState.Initialized, "ubi state");

        const final_extra_account_metas_account = await get_account(context, compto_extra_account_metas_account_pubkey, ExtraAccountMetaAccount);
        // comptoken program id
        const default_account_metas_account = get_default_extra_account_metas_account()
        Assert.assert(final_extra_account_metas_account.address.equals(default_account_metas_account.address), "address isn't correct");
        Assert.assertEqual(final_extra_account_metas_account.data.extraAccountsList.length, default_account_metas_account.data.extraAccountsList.length, "length isn't correct");
        let zipped = final_extra_account_metas_account.data.extraAccountsList.extraAccounts.map((v, i) => [v, default_account_metas_account.data.extraAccountsList.extraAccounts[i]]);
        for (const [final, oracle] of zipped) {
            Assert.assertEqual(final.discriminator, oracle.discriminator, "discriminators aren't the same");
            Assert.assertEqual(final.isSigner, oracle.isSigner, "isSigner isn't the same");
            Assert.assertEqual(final.isWritable, oracle.isWritable, "isWritable isn't the same");
            Assert.assert(isArrayEqual(final.addressConfig, oracle.addressConfig), "address configs aren't the same");
        }
    });
}

(async () => { await initialize_comptoken_program(); })();
