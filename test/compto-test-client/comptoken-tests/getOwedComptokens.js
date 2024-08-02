import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, start } from "solana-bankrun";

import {
    get_default_comptoken_mint, get_default_comptoken_wallet, get_default_global_data, get_default_unpaid_interest_bank,
    get_default_unpaid_ubi_bank, get_default_user_data_account, TokenAccount, UserDataAccount
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_program_id_pubkey, DEFAULT_DISTRIBUTION_TIME, DEFAULT_START_TIME, Instruction, SEC_PER_DAY, testuser_comptoken_wallet_pubkey } from "../common.js";

async function test_getOwedComptokens() {
    let comptoken_mint = get_default_comptoken_mint();
    comptoken_mint.supply = 292_004n
    let user_wallet = get_default_comptoken_wallet(testuser_comptoken_wallet_pubkey, PublicKey.unique());
    user_wallet.amount = 2n;
    let user_data_account_address = PublicKey.findProgramAddressSync([user_wallet.address.toBytes()], compto_program_id_pubkey)[0];
    let user_data = get_default_user_data_account(user_data_account_address);
    user_data.lastInterestPayoutDate = DEFAULT_DISTRIBUTION_TIME - SEC_PER_DAY;
    let global_data = get_default_global_data();
    global_data.dailyDistributionData.historicInterests[0] = 0.5;
    global_data.dailyDistributionData.oldestInterest = 1n;
    global_data.dailyDistributionData.yesterdaySupply = 292_004n;
    let interest_bank = get_default_unpaid_interest_bank();
    interest_bank.amount = 146_000n;
    let ubi_bank = get_default_unpaid_ubi_bank();
    ubi_bank.amount = 146_000n;

    const context = await start(
        [{ name: "comptoken", programId: compto_program_id_pubkey }],
        [
            user_data.toAccount(),
            user_wallet.toAccount(),
            comptoken_mint.toAccount(),
            global_data.toAccount(),
            interest_bank.toAccount(),
            ubi_bank.toAccount(),
        ]
    );
    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;
    const rent = await client.getRent();
    const keys = [
        //  User's Data Account stores how long it's been since they received owed comptokens
        { pubkey: user_data.address, isSigner: false, isWritable: true },
        //  User's Comptoken Wallet is the account to send the comptokens to
        { pubkey: user_wallet.address, isSigner: false, isWritable: true },
        //  Comptoken Mint lets the token program know what kind of token to move
        { pubkey: comptoken_mint.address, isSigner: false, isWritable: false },
        //  Comptoken Global Data (also mint authority) stores interest data
        { pubkey: global_data.address, isSigner: false, isWritable: false },
        //  Comptoken Interest Bank stores comptokens owed for interest
        { pubkey: interest_bank.address, isSigner: false, isWritable: true },
        //  Comptoken UBI Bank stores comptokens owed for UBI
        { pubkey: ubi_bank.address, isSigner: false, isWritable: true },
        //  Token 2022 Program moves the tokens
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    let data = Buffer.from([Instruction.GET_OWED_COMPTOKENS]);

    const ixs = [new TransactionInstruction({ programId: compto_program_id_pubkey, keys, data })];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(...ixs);
    tx.sign(payer);
    context.setClock(new Clock(0n, 0n, 0n, 0n, DEFAULT_START_TIME));
    const meta = await client.processTransaction(tx);

    let account = await client.getAccount(user_wallet.address);
    Assert.assertNotNull(account);
    let finalUserWallet = TokenAccount.fromAccountInfoBytes(user_wallet.address, account);
    Assert.assertEqual(finalUserWallet.amount, 3n, "interest amount");

    account = await client.getAccount(user_data.address);
    Assert.assertNotNull(account);
    let finalUserData = UserDataAccount.fromAccountInfoBytes(user_data.address, account);
    Assert.assertEqual(finalUserData.lastInterestPayoutDate, DEFAULT_DISTRIBUTION_TIME, "last interest payout date updated");
}

(async () => { await test_getOwedComptokens(); })();
