import { TOKEN_2022_PROGRAM_ID, TokenInstruction, transferCheckedInstructionData } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import {
    get_default_comptoken_mint,
    get_default_comptoken_wallet,
    get_default_extra_account_metas_account,
    get_default_user_data_account,
    TokenAccount
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, compto_transfer_hook_id_pubkey, COMPTOKEN_DECIMALS, DEFAULT_START_TIME } from "../common.js";

async function test_execute() {
    console.log("test execute")
    let comptoken_mint = get_default_comptoken_mint();
    const user1_owner = Keypair.generate()
    let user1 = get_default_comptoken_wallet(PublicKey.unique(), user1_owner.publicKey);
    user1.data.amount = 1n;
    let user2 = get_default_comptoken_wallet(PublicKey.unique(), PublicKey.unique());
    let user1_data = get_default_user_data_account(PublicKey.findProgramAddressSync([user1.address.toBytes()], compto_program_id_pubkey)[0]);
    let user2_data = get_default_user_data_account(PublicKey.findProgramAddressSync([user2.address.toBytes()], compto_program_id_pubkey)[0]);
    let extraAccountMetaAccount = get_default_extra_account_metas_account();

    const context = await start(
        [
            { name: "comptoken", programId: compto_program_id_pubkey },
            { name: "comptoken_transfer_hook", programId: compto_transfer_hook_id_pubkey },
        ],
        [
            user1.toAddedAccount(),
            comptoken_mint.toAddedAccount(),
            user2.toAddedAccount(),
            extraAccountMetaAccount.toAddedAccount(),
            user1_data.toAddedAccount(),
            user2_data.toAddedAccount(),
        ]
    );

    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;

    client.getAccountInfo = client.getAccount;
    const keys = [
        // transfer keys
        { pubkey: user1.address, isSigner: false, isWritable: true },
        { pubkey: comptoken_mint.address, isSigner: false, isWritable: false },
        { pubkey: user2.address, isSigner: false, isWritable: true },
        { pubkey: user1_owner.publicKey, isSigner: true, isWritable: false },
        // transfer hook api keys
        { pubkey: extraAccountMetaAccount.address, isSigner: false, isWritable: false },
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
    const ixs = [
        new TransactionInstruction({ programId: TOKEN_2022_PROGRAM_ID, keys, data })
    ];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.feePayer = payer.publicKey;
    tx.sign(payer, user1_owner);
    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME));
    const meta = await client.processTransaction(tx);

    console.log("logMessages: %s", meta.logMessages);
    console.log("computeUnitsConsumed: %d", meta.computeUnitsConsumed);
    console.log("returnData: %s", meta.returnData);

    let account = await client.getAccount(user2.address);
    Assert.assertNotNull(account);
    let finalUser2 = TokenAccount.fromAccountInfoBytes(user2.address, account);
    Assert.assertEqual(finalUser2.data.amount, 1n);

}

(async () => { await test_execute(); })();