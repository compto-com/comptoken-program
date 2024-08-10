import { AccountState, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import { get_default_comptoken_mint, GlobalDataAccount, TokenAccount, } from "../accounts.js";
import { Assert } from "../assert.js";
import {
    compto_program_id_pubkey, comptoken_mint_pubkey, DEFAULT_ANNOUNCE_TIME, DEFAULT_DISTRIBUTION_TIME, DEFAULT_START_TIME,
    global_data_account_pubkey, Instruction, interest_bank_account_pubkey, ubi_bank_account_pubkey
} from "../common.js";

async function initialize_comptoken_program() {
    const context = await start(
        [{ name: "comptoken", programId: compto_program_id_pubkey }],
        [get_default_comptoken_mint().toAccount()]
    );

    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;
    const rent = await client.getRent();
    const keys = [
        // the payer of the rent for the account
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        // the address of the global data account to be created
        { pubkey: global_data_account_pubkey, isSigner: false, isWritable: true },
        // the address of the interest bank account to be created
        { pubkey: interest_bank_account_pubkey, isSigner: false, isWritable: true },
        // the address of the ubi bank account to be created
        { pubkey: ubi_bank_account_pubkey, isSigner: false, isWritable: true },
        // the comptoken mint account
        { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: false },
        // needed because compto program interacts with the system program to create the account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        // the token program that will mint the tokens when instructed by the mint authority
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        // program will pull a recent hash from slothashes sysvar if a new valid blockhash is needed.
        { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
    ];

    // MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN comptoken.rs
    const GLOBAL_DATA_SIZE = 3032n;
    const globalDataRentExemptAmount = await rent.minimumBalance(GLOBAL_DATA_SIZE);
    const interestBankRentExemptAmount = await rent.minimumBalance(256n);
    const ubiBankRentExemptAmount = await rent.minimumBalance(256n);
    console.log("Rent exempt amount: ", globalDataRentExemptAmount);
    // 1 byte for instruction 3 x 8 bytes for rent exemptions
    let data = Buffer.alloc(25);
    data.writeUInt8(Instruction.INITIALIZE_STATIC_ACCOUNT, 0);
    data.writeBigInt64LE(globalDataRentExemptAmount, 1);
    data.writeBigInt64LE(interestBankRentExemptAmount, 9);
    data.writeBigInt64LE(ubiBankRentExemptAmount, 17);

    const ixs = [new TransactionInstruction({ programId: compto_program_id_pubkey, keys, data })];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.sign(payer);
    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME));
    const meta = await client.processTransaction(tx);

    console.log("logMessages: %s", meta.logMessages);
    console.log("computeUnitsConsumed: %d", meta.computeUnitsConsumed);
    console.log("returnData: %s", meta.returnData)

    let account = await client.getAccount(global_data_account_pubkey);
    Assert.assertNotNull(account);
    const finalGlobalData = GlobalDataAccount.fromAccountInfoBytes(global_data_account_pubkey, account);
    Assert.assertEqual(finalGlobalData.data.validBlockhashes.announcedBlockhashTime, DEFAULT_ANNOUNCE_TIME, "announced blockhash time");
    Assert.assertEqual(finalGlobalData.data.validBlockhashes.validBlockhashTime, DEFAULT_DISTRIBUTION_TIME, "valid blockhash time");

    account = await client.getAccount(interest_bank_account_pubkey);
    Assert.assertNotNull(account);
    const finalInterestBank = TokenAccount.fromAccountInfoBytes(interest_bank_account_pubkey, account);
    Assert.assertEqual(finalInterestBank.data.amount, 0n, "interest amount");
    Assert.assert(finalInterestBank.data.mint.equals(comptoken_mint_pubkey), "interest mint");
    Assert.assert(finalInterestBank.data.owner.equals(global_data_account_pubkey), "interest owner");
    Assert.assertEqual(finalInterestBank.data.state, AccountState.Initialized, "interest state");

    account = await client.getAccount(ubi_bank_account_pubkey);
    Assert.assertNotNull(account);
    const finalUBIBank = TokenAccount.fromAccountInfoBytes(ubi_bank_account_pubkey, account);
    Assert.assertEqual(finalUBIBank.data.amount, 0n, "ubi amount");
    Assert.assert(finalUBIBank.data.mint.equals(comptoken_mint_pubkey), "ubi mint");
    Assert.assert(finalUBIBank.data.owner.equals(global_data_account_pubkey), "ubi owner");
    Assert.assertEqual(finalUBIBank.data.state, AccountState.Initialized, "ubi state");
}

(async () => { await initialize_comptoken_program(); })();
