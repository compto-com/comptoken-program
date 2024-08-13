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
    const user1 = Keypair.generate();
    const comptoken_mint = get_default_comptoken_mint();
    let original_user1_comptoken_wallet = get_default_comptoken_wallet(PublicKey.unique(), user1.publicKey);
    original_user1_comptoken_wallet.data.amount = 1n;
    const user1_data_pda = PublicKey.findProgramAddressSync([original_user1_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    const user1_data_account = get_default_user_data_account(user1_data_pda);

    const original_user2_comptoken_wallet = get_default_comptoken_wallet(PublicKey.unique(), PublicKey.unique());
    const user2_data_pda = PublicKey.findProgramAddressSync([original_user2_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    const user2_data_account = get_default_user_data_account(user2_data_pda);

    const accounts = [
        comptoken_mint, original_user1_comptoken_wallet, user1_data_account, original_user2_comptoken_wallet, user2_data_account,
        get_default_extra_account_metas_account(),
    ];

    let context = await setup_test(accounts);

    // solana/web3.js createTransferCheckedInstructionWithTransferHook requires a connection, which bankrun replaces with a mock
    // with a similar interface. We can't use it here, so we'll create the instruction manually.
    const keys = [
        // transfer keys
        { pubkey: original_user1_comptoken_wallet.address, isSigner: false, isWritable: true },
        { pubkey: comptoken_mint.address, isSigner: false, isWritable: false },
        { pubkey: original_user2_comptoken_wallet.address, isSigner: false, isWritable: true },
        { pubkey: user1.publicKey, isSigner: true, isWritable: false },
        // transfer hook api keys
        { pubkey: get_default_extra_account_metas_account().address, isSigner: false, isWritable: false },
        // our transfer hook keys
        { pubkey: compto_program_id_pubkey, isSigner: false, isWritable: false },
        { pubkey: user1_data_account.address, isSigner: false, isWritable: false },
        { pubkey: user2_data_account.address, isSigner: false, isWritable: false },
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

    [context, result] = await run_test("execute", context, instructions, [context.payer, user1], async (context, result) => {
        const final_user1_comptoken_wallet = await get_account(context, original_user1_comptoken_wallet.address, TokenAccount);
        Assert.assertEqual(final_user1_comptoken_wallet.data.amount, 0n);

        const final_user2_comptoken_wallet = await get_account(context, original_user2_comptoken_wallet.address, TokenAccount);
        Assert.assertEqual(final_user2_comptoken_wallet.data.amount, 1n);
    });
}

(async () => { await test_execute(); })();