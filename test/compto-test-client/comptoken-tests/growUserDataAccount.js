import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import { get_default_comptoken_mint, get_default_global_data, get_default_testuser_comptoken_wallet, get_default_user_data_account, UserDataAccount } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, DEFAULT_START_TIME, Instruction } from "../common.js";

async function test_growUserDataAccount() {
    const testuser = Keypair.generate();
    let comptoken_mint = get_default_comptoken_mint();
    let global_data_account = get_default_global_data();
    let testuser_comptoken_wallet = get_default_testuser_comptoken_wallet(testuser.publicKey);
    let user_data_account = get_default_user_data_account(PublicKey.findProgramAddressSync([testuser_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0]);

    const context = await start(
        [{ name: "comptoken", programId: compto_program_id_pubkey }],
        [
            comptoken_mint.toAddedAccount(),
            global_data_account.toAddedAccount(),
            user_data_account.toAddedAccount(),
            testuser_comptoken_wallet.toAddedAccount(),
        ]
    );

    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;
    const rent = await client.getRent()

    const keys = [
        // the payer of the rent for the account
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        // the data account tied to the comptoken wallet
        { pubkey: user_data_account.address, isSigner: false, isWritable: true },
        // the payers comptoken wallet (comptoken token acct)
        { pubkey: testuser_comptoken_wallet.address, isSigner: false, isWritable: false },
        // system account is used to create the account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        // the owner of the comptoken wallet
        { pubkey: testuser.publicKey, isSigner: true, isWritable: false },
    ];

    // MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN user_data.rs
    const USER_DATA_MIN_SIZE = 88n;

    const test_grow_ix_data = Buffer.alloc(17);
    test_grow_ix_data.writeUInt8(Instruction.REALLOC_USER_DATA_ACCOUNT, 0);
    const USER_DATA_SIZE1 = USER_DATA_MIN_SIZE + 32n * 10n;
    const rentExemptAmount1 = await rent.minimumBalance(USER_DATA_SIZE1);
    test_grow_ix_data.writeBigInt64LE(rentExemptAmount1, 1);
    test_grow_ix_data.writeBigInt64LE(USER_DATA_SIZE1, 9);

    const test_shrink_ix_data = Buffer.alloc(17);
    test_shrink_ix_data.writeUInt8(Instruction.REALLOC_USER_DATA_ACCOUNT, 0);
    const USER_DATA_SIZE2 = USER_DATA_MIN_SIZE + 32n * 4n;
    const rentExemptAmount2 = await rent.minimumBalance(USER_DATA_SIZE2);
    test_shrink_ix_data.writeBigInt64LE(rentExemptAmount2, 1);
    test_shrink_ix_data.writeBigInt64LE(USER_DATA_SIZE2, 9);

    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME));
    const grow_instruction = new TransactionInstruction({ programId: compto_program_id_pubkey, keys, data: test_grow_ix_data });

    const grow_userdata_tx = new Transaction();
    grow_userdata_tx.recentBlockhash = blockhash;
    grow_userdata_tx.add(grow_instruction);
    grow_userdata_tx.sign(payer, testuser);
    const meta1 = await client.processTransaction(grow_userdata_tx);

    console.log("logMessages 1: %s", meta1.logMessages);
    console.log("computeUnitsConsumed 1: %d", meta1.computeUnitsConsumed);
    console.log("returnData 1: %s", meta1.returnData)

    let account = await client.getAccount(user_data_account.address);
    Assert.assertNotNull(account);
    const finalUserData1 = UserDataAccount.fromAccountInfoBytes(user_data_account.address, account);
    Assert.assertEqual(USER_DATA_SIZE1, BigInt(account.data.length));

    const shrink_instruction = new TransactionInstruction({ programId: compto_program_id_pubkey, keys, data: test_shrink_ix_data });
    const shrink_userdata_tx = new Transaction();
    shrink_userdata_tx.recentBlockhash = blockhash;
    shrink_userdata_tx.add(shrink_instruction);
    shrink_userdata_tx.sign(payer, testuser);
    const result2 = await client.tryProcessTransaction(shrink_userdata_tx);
    const meta2 = result2.meta;

    console.log("logMessages 2: %s", meta2.logMessages);
    console.log("computeUnitsConsumed 2: %d", meta2.computeUnitsConsumed);
    console.log("returnData 2: %s", meta2.returnData)

    Assert.assertNotNull(result2.result, "program should fail");
}

(async () => { await test_growUserDataAccount(); })();