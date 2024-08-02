import { SYSVAR_SLOT_HASHES_PUBKEY, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { get_default_comptoken_mint, get_default_global_data, get_default_unpaid_interest_bank, get_default_unpaid_ubi_bank, GlobalDataAccount, MintAccount, TokenAccount } from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, DEFAULT_ANNOUNCE_TIME, DEFAULT_DISTRIBUTION_TIME, DEFAULT_START_TIME, Instruction, SEC_PER_DAY } from "../common.js";

async function test_dailyDistributionEvent() {
    let comptoken_mint = get_default_comptoken_mint();
    comptoken_mint.supply += 1n;
    let global_data = get_default_global_data();
    let interest_bank = get_default_unpaid_interest_bank();
    let ubi_bank = get_default_unpaid_ubi_bank();
    const context = await start(
        [{ name: "comptoken", programId: compto_program_id_pubkey }],
        [
            comptoken_mint.toAccount(),
            global_data.toAccount(),
            interest_bank.toAccount(),
            ubi_bank.toAccount(),
        ]
    );

    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;
    const keys = [
        // so the token program knows what kind of token
        { pubkey: comptoken_mint.address, isSigner: false, isWritable: true },
        // stores information for/from the daily distribution
        { pubkey: global_data.address, isSigner: false, isWritable: true },
        // comptoken token account used as bank for unpaid interest
        { pubkey: interest_bank.address, isSigner: false, isWritable: true },
        // comptoken token account used as bank for unpaid Universal Basic Income
        { pubkey: ubi_bank.address, isSigner: false, isWritable: true },
        // the token program that will mint the tokens when instructed by the mint authority
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        // program will pull a recent hash from slothashes sysvar if a new valid blockhash is needed.  
        { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
    ];

    let data = Buffer.from([Instruction.DAILY_DISTRIBUTION_EVENT])

    const ixs = [new TransactionInstruction({ programId: compto_program_id_pubkey, keys, data })];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.sign(payer);
    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME));
    const result = await client.simulateTransaction(tx);

    // TODO: make this assert less brittle
    Assert.assert(result.meta.logMessages[3].includes("daily distribution already called today"), "daily distribution already called");

    let account = await client.getAccount(comptoken_mint.address);
    Assert.assertNotNull(account);
    const failMint = MintAccount.fromAccountInfoBytes(comptoken_mint.address, account);
    Assert.assertEqual(failMint.supply, comptoken_mint.supply, "interest has not been issued");

    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME + SEC_PER_DAY));
    const meta = await client.processTransaction(tx);

    account = await client.getAccount(comptoken_mint.address);
    Assert.assertNotNull(account);
    const finalMint = MintAccount.fromAccountInfoBytes(comptoken_mint.address, account);
    Assert.assert(finalMint.supply > comptoken_mint.supply, "interest has been applied");

    account = await client.getAccount(global_data.address);
    Assert.assertNotNull(account);
    const finalGlobalData = GlobalDataAccount.fromAccountInfoBytes(global_data.address, account);
    const validBlockhash = finalGlobalData.validBlockhashes;
    const dailyDistributionData = finalGlobalData.dailyDistributionData;
    Assert.assertEqual(validBlockhash.announcedBlockhashTime, DEFAULT_ANNOUNCE_TIME + SEC_PER_DAY, "the announced blockhash time has been updated");
    Assert.assertNotEqual(validBlockhash.announcedBlockhash, global_data.validBlockhashes.announcedBlockhash, "announced blockhash has changed"); // TODO: can the actual blockhash be predicted/gotten?
    Assert.assertEqual(validBlockhash.validBlockhashTime, DEFAULT_DISTRIBUTION_TIME + SEC_PER_DAY, "the valid blockhash time has been updated");
    Assert.assertNotEqual(validBlockhash.validBlockhash, global_data.validBlockhashes.validBlockhash, "valid blockhash has changed");

    Assert.assertEqual(dailyDistributionData.highWaterMark, 2n, "highwater mark has increased"); // TODO: find a better way to get oracle value
    Assert.assertEqual(dailyDistributionData.lastDailyDistributionTime, DEFAULT_DISTRIBUTION_TIME + SEC_PER_DAY, "last daily distribution time has updated");
    Assert.assertEqual(dailyDistributionData.yesterdaySupply, finalMint.supply, "yesterdays supply is where the mint is after");
    Assert.assertEqual(dailyDistributionData.oldestInterest, global_data.dailyDistributionData.oldestInterest + 1n, "oldest interests has increased");

    account = await client.getAccount(interest_bank.address);
    Assert.assertNotNull(account);
    const finalInterestBank = TokenAccount.fromAccountInfoBytes(interest_bank.address, account);
    Assert.assert(finalInterestBank.amount > interest_bank.amount, "interest bank has increased");

    account = await client.getAccount(ubi_bank.address);
    Assert.assertNotNull(account);
    const finalUbiBank = TokenAccount.fromAccountInfoBytes(ubi_bank.address, account);
    Assert.assert(finalUbiBank.amount > ubi_bank.amount, "interest bank has increased");
}

(async () => { await test_dailyDistributionEvent(); })();
