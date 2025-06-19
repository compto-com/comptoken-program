import {
    createVerifyHumanInstruction,
    GlobalDataAccount,
    SEC_PER_DAY,
    TokenAccount,
    UserDataAccount,
} from "@compto/comptoken.js";
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";

import {
    get_default_comptoken_mint,
    get_default_comptoken_token_account,
    get_default_extra_account_metas_account,
    get_default_global_data,
    get_default_unpaid_future_ubi_bank,
    get_default_user_data_account,
    WorldIdConfig,
    WorldIdConfigAccount,
    WorldIdLatestRoot,
    WorldIdLatestRootAccount,
    WorldIdRoot,
    WorldIdRootAccount,
} from "../accounts.js";
import { Assert } from "../assert.js";
import { compto_public_keys, DEFAULT_DISTRIBUTION_TIME, DEFAULT_START_TIME } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";

async function testVerifyHuman() {
    // appId:  "self_hosted"
    // action: "COMPTO-VerifyHuman"
    // signal: "0x8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c" // user wallet address
    const idkitResult = {
        proof:
            "0x" +
            "2b51a7d604a61ac24b6a1999b71e1990d20c6d7f1c66067ff510c42814535301" +
            "1173e5129b2570d156384a05640161f59ca720a32fdbd52c06215823f12ca93e" +
            "14eeb39f03c8da6f0d169e13b944b14b4b24185d5d12c4b200bc9c13f4893f89" +
            "2359405b9a367182927ad6c0aebd475dbc86176c584ae89e003abab45199842c" +
            "14714401354f3c1b05c95997dfe9d2813cfea3c889db138be0b2d4f90053a60e" +
            "244b97d17c7bb6953790b1a23a9755cff48c8f8449bd74960d44a119282b1f6f" +
            "176825121ef2377c41ad9b56acf56c61dfde353e658aa08254aa0f3ae367f6c7" +
            "069cb422d80e4e586f1961552b2b6c0694569c1f815e6b907a03549698c6382a",
        merkle_root:
            "0x28836d5b43240ca2763eb0997dcd346b6e3225bfc32fb881e880b5bd116a117c",
        nullifier_hash:
            "0x06e05b30363654d2be77b7b16091735f139f31bc097bb2a1aa9450b96f7df677",
        verification_level: "orb",
    }

    const proof = Buffer.from(idkitResult.proof.slice(2), "hex");
    const root_hash = Buffer.from(idkitResult.merkle_root.slice(2), "hex");
    const nullifier_hash = Buffer.from(idkitResult.nullifier_hash.slice(2), "hex");

    const WORLD_VERIFICATION_TYPE = 1;

    const WORLD_ID_PROGRAM = new PublicKey("9TMVfMJs6qyu8jnc7TJfAWhn81Ju2uSRj4uYqLHyKXnh");

    const user = Keypair.fromSeed(new Uint8Array(32).fill(0x01));
    let original_comptoken_mint = get_default_comptoken_mint();
    original_comptoken_mint.data.supply = 1_000_000_000n;
    const original_global_data = get_default_global_data();
    let original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();
    original_unpaid_future_ubi_bank.data.amount = 1_000_000_000n;
    const original_user_comptoken_wallet = get_default_comptoken_token_account(new PublicKey(Buffer.from("8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c", "hex")), user.publicKey);

    const user_data_pda = PublicKey.findProgramAddressSync([original_user_comptoken_wallet.address.toBytes()], compto_public_keys.compto_program_id_pubkey)[0];
    const original_user_data_account = get_default_user_data_account(user_data_pda);


    const [world_id_root_address, world_id_root_bump] = PublicKey.findProgramAddressSync([Buffer.from("Root"), root_hash, [WORLD_VERIFICATION_TYPE]], WORLD_ID_PROGRAM);
    const world_id_root_account = new WorldIdRootAccount(
        world_id_root_address,
        10_000n,
        WORLD_ID_PROGRAM,
        new WorldIdRoot({
            discriminator: Buffer.from([0x2e, 0x9f, 0x83, 0x25, 0xf5, 0x54, 0x05, 0x09]),
            bump: world_id_root_bump,
            read_block_number: 1n,
            read_block_hash: Buffer.from(Array.from({ length: 32 }, (v, i) => i * 3)),
            read_block_time: DEFAULT_START_TIME,
            refund_recipient: user.publicKey,
            root: root_hash,
            verification_type: Buffer.from([WORLD_VERIFICATION_TYPE]),
        }),
    );

    const [world_id_latest_root_address, world_id_latest_root_bump] = PublicKey.findProgramAddressSync([Buffer.from("LatestRoot"), [WORLD_VERIFICATION_TYPE]], WORLD_ID_PROGRAM);
    const world_id_latest_root_account = new WorldIdLatestRootAccount(
        world_id_latest_root_address,
        10_000n,
        WORLD_ID_PROGRAM,
        new WorldIdLatestRoot({
            discriminator: Buffer.from([0x0c, 0xf5, 0xe7, 0xf6, 0xbf, 0x3f, 0xa9, 0x5f]),
            bump: world_id_latest_root_bump,
            read_block_number: 1n,
            read_block_hash: Buffer.from(Array.from({ length: 32 }, (v, i) => i * 3)),
            read_block_time: DEFAULT_START_TIME,
            root: root_hash,
            verification_type: Buffer.from([WORLD_VERIFICATION_TYPE]),
        }),
    );

    const [world_id_config_address, world_id_config_bump] = PublicKey.findProgramAddressSync([Buffer.from("Config")], WORLD_ID_PROGRAM);
    const world_id_config_account = new WorldIdConfigAccount(
        world_id_config_address,
        10_000n,
        WORLD_ID_PROGRAM,
        new WorldIdConfig({
            discriminator: Buffer.from([0x9b, 0x0c, 0xaa, 0xe0, 0x1e, 0xfa, 0xcc, 0x82]),
            bump: world_id_config_bump,
            owner: user.publicKey,
            pendingOwnerOption: 0,
            pendingOwner: PublicKey.default,
            root_expire: BigInt(SEC_PER_DAY * 2),
            allowed_update_staleness: BigInt(SEC_PER_DAY),
        }),
    );

    const existing_accounts = [
        original_comptoken_mint, original_global_data, original_unpaid_future_ubi_bank, original_user_comptoken_wallet, original_user_data_account,
        get_default_extra_account_metas_account(), world_id_root_account, world_id_config_account, world_id_latest_root_account,
    ];

    let context = await setup_test(existing_accounts);
    let connection = {
        async getMinimumBalanceForRentExemption(dataLength, commitment) {
            let rent = await context.banksClient.getRent();
            return rent.minimumBalance(BigInt(dataLength));
        }
    }

    const instructions = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        await createVerifyHumanInstruction(
            connection,
            context.payer.publicKey,
            user.publicKey,
            original_user_comptoken_wallet.address,
            root_hash,
            nullifier_hash,
            proof,
            compto_public_keys,
        ),
    ];

    context = await run_test("VerifyHuman", context, instructions, [context.payer, user], false, async (context, result) => {
        const final_user_data_account = await get_account(context, user_data_pda, UserDataAccount);
        Assert.assertEqual(final_user_data_account.data.verificationDate, DEFAULT_DISTRIBUTION_TIME, "user data verificationDate");

        const final_user_comptoken_wallet = await get_account(context, original_user_comptoken_wallet.address, TokenAccount);
        // one billionth of one billion tokens
        Assert.assertEqual(final_user_comptoken_wallet.data.amount, original_user_comptoken_wallet.data.amount + 1n, "user comptoken wallet amount");

        const final_global_data = await get_account(context, original_global_data.address, GlobalDataAccount);
        Assert.assertEqual(
            final_global_data.data.dailyDistributionData.verifiedHumans,
            original_global_data.data.dailyDistributionData.verifiedHumans + 1n,
            "global data totalVerifiedHumans"
        );
    });
}

(async () => { await testVerifyHuman(); })();