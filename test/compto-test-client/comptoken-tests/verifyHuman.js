import {
    createVerifyHumanInstruction,
    GlobalDataAccount,
    SEC_PER_DAY,
    TokenAccount,
    UserDataAccount,
} from "@compto/comptoken.js";
import { Keypair, PublicKey } from "@solana/web3.js";

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
import { compto_public_keys, DEFAULT_START_TIME } from "../common.js";
import { get_account, run_test, setup_test } from "../generic_test.js";

async function testVerifyHuman() {
    const nullifier_hash = Buffer.from("1c9ad277b4e02ec68d8922c5dc7aa37067941714c50b8fb973bbb050991a13b0", "hex");
    const root_hash = Buffer.from(
        "0b0b2aa02553f99a9b10982c74d6a8cd723b337fafe4aa33351c858b74372223", "hex");
    const proof = Buffer.from(
        "18bf1fdb3d368aab104b3f721cc822e5033efa30aa95f1e9d95b60dfdd37cff9" +
        "255de19aa19e093fe6cf668db6a9543592274daa237519434fbc8ae20d99c4b9" +
        "2a0affa5c885df7bd9e906fd0a61c1480e9f221744e1af612e62bff02def8a96" +
        "2ee582fca7aad4ba2a00714be40648e6290fd20556ead693e620862d17700a5f" +
        "259a7c384db720a1657bace542b9978fe80be1d8a779520a2d1cb0a2b76e5a4a" +
        "173f4540eb6489c6dd64b5f55444dd5b7c70ba92631a3dbf48e8fadf1c056e03" +
        "2281ba334040db8cfe35f3d59f34a413118486fd8763c4b4e46a9f87cd5fdecb" +
        "22cc9f59758e2498ec4cd9a16f0cce63368e2497fb7a5aa2b7a1223d08267960",
        "hex"
    );
    const WORLD_VERIFICATION_TYPE = 0;

    const WORLD_ID_PROGRAM = new PublicKey("9TMVfMJs6qyu8jnc7TJfAWhn81Ju2uSRj4uYqLHyKXnh");

    const user = Keypair.generate();
    let original_comptoken_mint = get_default_comptoken_mint();
    original_comptoken_mint.data.supply = 1_000_000_000n;
    const original_global_data = get_default_global_data();
    let original_unpaid_future_ubi_bank = get_default_unpaid_future_ubi_bank();
    original_unpaid_future_ubi_bank.data.amount = 1_000_000_000n;
    const original_user_comptoken_wallet = get_default_comptoken_token_account(PublicKey.unique(), user.publicKey);

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
        Assert.assert(final_user_data_account.data.isVerifiedHuman, "user data isVerifiedHuman");

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

    Assert.assert(false, "this test is currently for manual verification only");
}

(async () => { await testVerifyHuman(); })();