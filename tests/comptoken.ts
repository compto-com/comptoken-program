import * as anchor from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import { expect } from "chai";
import { type AddedAccount } from "solana-bankrun";
const { BN } = anchor;

import {
    Idl,
    baseProgram,
    createGlobalDataAddedAccount,
    createStakedMintAddedAccount,
    createStakedTokenAccountAddedAccount,
    createUnstakedMintAddedAccount,
    createUnstakedTokenAccountAddedAccount,
    createUserDataAddedAccount,
    getAccount,
    getMint,
} from "./utils/accountPreinitHelpers";
import { getProgramWithConstants } from "./utils/typeHelpers";
import { normalizeTime } from "./utils/utils";

async function prepareTest(accounts: AddedAccount[] = []) {
    const context = await startAnchor(import.meta.dirname + "/..", [], accounts);
    const provider = new BankrunProvider(context);
    const program = getProgramWithConstants(Idl, provider);

    return { context, provider, program };
}

describe("comptoken", async () => {
    it("initialize: creates staked/unstaked mints and global data", async () => {
        const { provider, program } = await prepareTest();
        // Derive the mint addresses using the same seeds as in the program
        const [stakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.stakedMintSeed)],
            program.programId,
        );

        const [unstakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.unstakedMintSeed)],
            program.programId,
        );

        // Derive the GlobalData PDA using the same seed as in the program
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId,
        );

        // Execute the initialize instruction
        const _tx = await program.methods
            .initialize()
            .accounts({
                slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
            })
            .rpc();

        // Verify the staked mint was created
        const stakedMintInfo = await provider.connection.getAccountInfo(stakedMintPda);
        expect(stakedMintInfo, "Staked mint account should exist").to.not.be.null;
        expect(stakedMintInfo!.owner.toString(), "Staked mint should be owned by Token2022 program").to.equal(
            TOKEN_2022_PROGRAM_ID.toString(),
        );

        // Verify the unstaked mint was created
        const unstakedMintInfo = await provider.connection.getAccountInfo(unstakedMintPda);
        expect(unstakedMintInfo, "Unstaked mint account should exist").to.not.be.null;
        expect(unstakedMintInfo!.owner.toString(), "Unstaked mint should be owned by Token2022 program").to.equal(
            TOKEN_2022_PROGRAM_ID.toString(),
        );

        // Verify account sizes are different (staked mint should be larger due to NonTransferable extension)
        expect(
            stakedMintInfo!.data.length,
            "Staked mint account size should be a mint with NonTransferable extension",
        ).to.equal(170);
        expect(unstakedMintInfo!.data.length, "Unstaked mint account size should be a standard mint").to.equal(82);

        // Additional verification: ensure accounts are properly initialized and not empty
        expect(stakedMintInfo!.data.length).to.be.greaterThan(0);
        expect(unstakedMintInfo!.data.length).to.be.greaterThan(0);
        console.log("✓ Both mints have valid data");

        // Verify the GlobalData account was created and is owned by our program
        const globalDataInfo = await provider.connection.getAccountInfo(globalDataPda);
        expect(globalDataInfo, "GlobalData account should exist").to.not.be.null;
        expect(globalDataInfo!.owner.toString(), "GlobalData should be owned by the comptoken program").to.equal(
            program.programId.toString(),
        );

        // Optionally decode and sanity-check initial GlobalData fields
        const globalData = await program.account.globalData.fetch(globalDataPda);

        // DailyDistributionData starts zeroed and timestamp initialized
        expect(globalData.dailyDistribution.totalMinedToday.toNumber()).to.equal(0);
        expect(globalData.dailyDistribution.highWaterMark.toNumber()).to.equal(0);
        expect(globalData.dailyDistribution.verifiedAccountsCount).to.equal(0);
        expect(globalData.dailyDistribution.lastUpdateTimestamp.toNumber()).to.be.greaterThan(0);

        // ValidBlockhashes should be populated with current network values
        const announced = globalData.validBlockhashes.announcedBlockhash[0];
        const valid = globalData.validBlockhashes.validBlockhash[0];
        expect(Array.isArray(announced) && announced.length === 32, "Announced blockhash must be 32 bytes").to.be.true;
        expect(Array.isArray(valid) && valid.length === 32, "Valid blockhash must be 32 bytes").to.be.true;
        expect(globalData.validBlockhashes.announcedBlockhashTime.toNumber()).to.be.greaterThan(0);
        expect(globalData.validBlockhashes.validBlockhashTime.toNumber()).to.be.greaterThan(0);
        console.log("✓ GlobalData account initialized with expected defaults");
    });

    it("create_user_data_account: creates user data with capacity", async () => {
        const { provider, program } = await prepareTest();
        // Derive the UserData PDA using the same seed as in the program
        const userPubkey = provider.wallet.publicKey;
        const [userDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.userDataSeed), userPubkey.toBuffer()],
            program.programId,
        );

        // Execute the create_user_data instruction
        const _tx = await program.methods
            .createUserDataAccount({ capacity: new BN.BN(10) })
            .accounts({
                payer: userPubkey,
                userWallet: userPubkey,
            })
            .rpc();

        // Verify the UserData account was created and is owned by our program
        const userDataInfo = await provider.connection.getAccountInfo(userDataPda);
        expect(userDataInfo, "UserData account should exist").to.not.be.null;
        expect(userDataInfo!.owner.toString(), "UserData should be owned by the comptoken program").to.equal(
            program.programId.toString(),
        );

        const userData = await program.account.userData.fetch(userDataPda);
        expect(userData.lastClaimedTimestamp.toNumber(), "Last claimed timestamp should be initialized").to.equal(
            normalizeTime(new Date()).getTime() / 1000,
        );
        expect(userData.lastVerifiedTimestamp.toNumber(), "Last verified timestamp should be 0").to.equal(
            new Date(0).getTime() / 1000,
        );
        expect(userData.proofs.length, "Proofs array should be empty").to.equal(0);

        expect(userDataInfo.data.length, "UserData account size should match allocated size").to.equal(
            8 + // discriminator
                8 + // last_claimed_timestamp
                8 + // last_verified_timestamp
                32 + // nullifier_hash
                32 + // recent_blockhash
                4 + // proofs vec length
                10 * 32, // proofs capacity (10) * size of each proof (32 bytes)
        );

        console.log("✓ UserData account initialized with expected defaults");
    });

    it("collect: claims nothing when available reward is 0", async () => {
        const user = Keypair.generate();

        const [userDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(baseProgram.constants.userDataSeed), user.publicKey.toBuffer()],
            baseProgram.programId,
        );
        const [stakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(baseProgram.constants.stakedMintSeed)],
            baseProgram.programId,
        );
        const [unstakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(baseProgram.constants.unstakedMintSeed)],
            baseProgram.programId,
        );
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(baseProgram.constants.globalDataSeed)],
            baseProgram.programId,
        );

        const userStakedAta = getAssociatedTokenAddressSync(
            stakedMintPda,
            user.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
        );
        const userUnstakedAta = getAssociatedTokenAddressSync(
            unstakedMintPda,
            user.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
        );

        const accounts = await Promise.all([
            createUserDataAddedAccount({ userPubkey: user.publicKey }),
            createGlobalDataAddedAccount(),
            createStakedMintAddedAccount(),
            createUnstakedMintAddedAccount(),
            createStakedTokenAccountAddedAccount({ address: userStakedAta, owner: user.publicKey, amount: 2 }),
            createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 5 }),
        ]);

        const { provider, program } = await prepareTest(accounts);

        const [beforeUnstaked, beforeStaked, beforeUnstakedMint, beforeStakedMint, beforeUserData, beforeGlobalData] =
            await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getAccount(provider.connection, userStakedAta),
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
                program.account.userData.fetch(userDataPda),
                program.account.globalData.fetch(globalDataPda),
            ]);

        const _sig = await program.methods
            .collect()
            .accounts({
                userWallet: user.publicKey,
                userStakedTokenAccount: userStakedAta,
                userUnstakedTokenAccount: userUnstakedAta,
            })
            .signers([user])
            .rpc();

        // Verify no error and state remains consistent
        const [afterUnstaked, afterStaked, afterUnstakedMint, afterStakedMint, afterUserData, afterGlobalData] =
            await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getAccount(provider.connection, userStakedAta),
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
                program.account.userData.fetch(userDataPda),
                program.account.globalData.fetch(globalDataPda),
            ]);

        // With zero staked principal and no verification UBI, collect should mint 0
        expect(afterUnstaked.amount).to.equal(beforeUnstaked.amount);
        expect(afterStaked.amount).to.equal(beforeStaked.amount);
        expect(afterUnstakedMint.supply).to.equal(beforeUnstakedMint.supply);
        expect(afterStakedMint.supply).to.equal(beforeStakedMint.supply);
        expect(afterGlobalData.dailyDistribution.totalMinedToday.toNumber()).to.equal(
            beforeGlobalData.dailyDistribution.totalMinedToday.toNumber(),
        );

        // last_claimed should be updated to normalized today
        expect(beforeUserData.lastClaimedTimestamp.toNumber()).to.be.lessThan(
            afterUserData.lastClaimedTimestamp.toNumber(),
        );
        expect(afterUserData.lastClaimedTimestamp.toNumber()).to.equal(normalizeTime(new Date()).getTime() / 1000);
    });
});
