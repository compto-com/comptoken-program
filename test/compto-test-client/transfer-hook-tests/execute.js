import { TOKEN_2022_PROGRAM_ID, TokenInstruction, transferCheckedInstructionData } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_wallet,
    get_default_extra_account_metas_account,
    get_default_user_data_account,
    TokenAccount
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, compto_transfer_hook_id_pubkey, COMPTOKEN_DECIMALS } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";

async function test_execute() {
    const user1_owner = Keypair.generate();

    const comptoken_mint = get_default_comptoken_mint();
    let user1 = get_default_comptoken_wallet(PublicKey.unique(), user1_owner.publicKey);
    user1.data.amount = 1n;
    const user1_data = get_default_user_data_account(PublicKey.findProgramAddressSync([user1.address.toBytes()], compto_program_id_pubkey)[0]);

    const user2 = get_default_comptoken_wallet(PublicKey.unique(), PublicKey.unique());
    const user2_data = get_default_user_data_account(PublicKey.findProgramAddressSync([user2.address.toBytes()], compto_program_id_pubkey)[0]);

    const accounts = [
        comptoken_mint,
        user1,
        user1_data,
        user2,
        user2_data,
        get_default_extra_account_metas_account(),
    ];

    let context = await setup_test(accounts);

    // solana/web3.js createTransferCheckedInstructionWithTransferHook requires a connection, which bankrun replaces with a mock
    // with a similar interface. We can't use it here, so we'll create the instruction manually.
    const keys = [
        // transfer keys
        { pubkey: user1.address, isSigner: false, isWritable: true },
        { pubkey: comptoken_mint.address, isSigner: false, isWritable: false },
        { pubkey: user2.address, isSigner: false, isWritable: true },
        { pubkey: user1_owner.publicKey, isSigner: true, isWritable: false },
        // transfer hook api keys
        { pubkey: get_default_extra_account_metas_account().address, isSigner: false, isWritable: false },
        // our transfer hook keys
        { pubkey: compto_program_id_pubkey, isSigner: false, isWritable: false },
        { pubkey: user1_data.address, isSigner: false, isWritable: false },
        { pubkey: user2_data.address, isSigner: false, isWritable: false },
        // transfer hook program
        { pubkey: compto_transfer_hook_id_pubkey, isSigner: false, isWritable: false },
    ]

    const data = Buffer.alloc(transferCheckedInstructionData.span);
    transferCheckedInstructionData.encode(
        {
            instruction: TokenInstruction.TransferChecked,
            amount: 1n,
            MINT_DECIMALS: COMPTOKEN_DECIMALS,
        },
        data
    );

    let instructions = [new TransactionInstruction({ programId: TOKEN_2022_PROGRAM_ID, keys, data })];
    let result;

    [context, result] = await run_test("execute", context, instructions, [context.payer, user1_owner], async (context, result) => {
        const finalUser1 = await get_account(context, user1.address, TokenAccount);
        Assert.assertEqual(finalUser1.data.amount, 0n);

        const finalUser2 = await get_account(context, user2.address, TokenAccount);
        Assert.assertEqual(finalUser2.data.amount, 1n);
    });
}

(async () => { await test_execute(); })();