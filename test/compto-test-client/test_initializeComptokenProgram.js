import { AccountState, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import { get_default_comptoken_mint, GlobalDataAccount, programId, TokenAccount, } from "./accounts.js";
import { Assert } from "./assert.js";
import {
    comptoken_mint_pubkey, DEFAULT_ANNOUNCE_TIME, DEFAULT_DISTRIBUTION_TIME, DEFAULT_START_TIME, global_data_account_pubkey, Instruction,
    interest_bank_account_pubkey, ubi_bank_account_pubkey
} from "./common.js";

async function initialize_comptoken_program() {
    const context = await start(
        [{ name: "comptoken", programId }],
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

    const ixs = [new TransactionInstruction({ programId, keys, data })];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.sign(payer);
    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME));
    const meta = await client.processTransaction(tx);

    const finalGlobalData = GlobalDataAccount.fromAccountInfoBytes(global_data_account_pubkey, await client.getAccount(global_data_account_pubkey));
    Assert.assertEqual(finalGlobalData.validBlockhashes.announcedBlockhashTime, DEFAULT_ANNOUNCE_TIME, "announced blockhash time");
    Assert.assertEqual(finalGlobalData.validBlockhashes.validBlockhashTime, DEFAULT_DISTRIBUTION_TIME, "valid blockhash time");

    const finalInterestBank = TokenAccount.fromAccountInfoBytes(interest_bank_account_pubkey, await client.getAccount(interest_bank_account_pubkey));
    Assert.assertEqual(finalInterestBank.amount, 0n, "interest amount");
    Assert.assert(finalInterestBank.mint.equals(comptoken_mint_pubkey), "interest mint");
    Assert.assert(finalInterestBank.nominalOwner.equals(global_data_account_pubkey), "interest owner");
    Assert.assertEqual(finalInterestBank.state, AccountState.Initialized, "interest state");

    const finalUBIBank = TokenAccount.fromAccountInfoBytes(ubi_bank_account_pubkey, await client.getAccount(ubi_bank_account_pubkey));
    Assert.assertEqual(finalUBIBank.amount, 0n, "ubi amount");
    Assert.assert(finalUBIBank.mint.equals(comptoken_mint_pubkey), "ubi mint");
    Assert.assert(finalUBIBank.nominalOwner.equals(global_data_account_pubkey), "ubi owner");
    Assert.assertEqual(finalUBIBank.state, AccountState.Initialized, "ubi state");
}

(async () => { await initialize_comptoken_program(); })();
