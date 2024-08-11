import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import { get_default_comptoken_mint, get_default_global_data, get_default_testuser_comptoken_wallet, UserDataAccount } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey } from "../common.js";
import { Instruction } from "../instruction.js";

async function test_createUserDataAccount() {
    const testuser = Keypair.generate();
    let comptoken_mint = get_default_comptoken_mint();
    let global_data_account = get_default_global_data();
    let testuser_comptoken_wallet = get_default_testuser_comptoken_wallet(testuser.publicKey);

    const context = await start(
        [{ name: "comptoken", programId: compto_program_id_pubkey }],
        [
            comptoken_mint.toAddedAccount(),
            global_data_account.toAddedAccount(),
            testuser_comptoken_wallet.toAddedAccount(),
        ]
    );

    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;
    const rent = await client.getRent()
    let user_data_account = PublicKey.findProgramAddressSync([testuser_comptoken_wallet.address.toBytes()], compto_program_id_pubkey)[0];

    const keys = [
        // the payer of the rent for the account
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        // the data account tied to the comptoken wallet
        { pubkey: user_data_account, isSigner: false, isWritable: true },
        // the payers comptoken wallet (comptoken token acct)
        { pubkey: testuser_comptoken_wallet.address, isSigner: false, isWritable: false },
        // system account is used to create the account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        // the owner of the comptoken wallet
        { pubkey: testuser.publicKey, isSigner: true, isWritable: false },
    ];

    // MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN user_data.rs
    const PROOF_STORAGE_MIN_SIZE = 88n;
    const rentExemptAmount = await rent.minimumBalance(PROOF_STORAGE_MIN_SIZE);

    let data = Buffer.alloc(17);
    data.writeUInt8(Instruction.CREATE_USER_DATA_ACCOUNT, 0);
    data.writeBigInt64LE(rentExemptAmount, 1);
    data.writeBigInt64LE(PROOF_STORAGE_MIN_SIZE, 9);

    const ixs = [new TransactionInstruction({ programId: compto_program_id_pubkey, keys, data })];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.sign(payer, testuser);
    context.setClock(new Clock(0n, 0n, 0n, 0n, 1_721_940_656n));
    const meta = await client.processTransaction(tx);

    console.log("logMessages: %s", meta.logMessages);
    console.log("computeUnitsConsumed: %d", meta.computeUnitsConsumed);
    console.log("returnData: %s", meta.returnData)

    const finalUserData = UserDataAccount.fromAccountInfoBytes(user_data_account, await client.getAccount(user_data_account));
    Assert.assertEqual(finalUserData.data.lastInterestPayoutDate, 1_721_865_600n, "user data lastInterestPayoutDate");
    Assert.assert(!finalUserData.data.isVerifiedHuman, "user data isVerifiedHuman");
}

(async () => { await test_createUserDataAccount(); })();