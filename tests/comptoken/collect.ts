import { default as anchor } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

import {
    baseProgram,
    createGlobalDataAddedAccount,
    createStakedMintAddedAccount,
    createStakedTokenAccountAddedAccount,
    createUnstakedMintAddedAccount,
    createUnstakedTokenAccountAddedAccount,
    createUserDataAddedAccount,
    getAccount,
    getMint,
} from "./utils/accountPreinitHelpers.ts";
import { normalizeTime, prepareTest, weekAgo } from "./utils/utils.ts";

describe("collect:", () => {
    beforeEach(() => {
        process.stdout;
    });

    it("claims nothing when available reward is 0", async () => {
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
            createUserDataAddedAccount({ userPubkey: user.publicKey, lastClaimed: weekAgo }),
            createGlobalDataAddedAccount(),
            createStakedMintAddedAccount(),
            createUnstakedMintAddedAccount(),
            createStakedTokenAccountAddedAccount({ owner: user.publicKey, amount: 2 }),
            createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 5 }),
        ]);

        const { provider, program } = await prepareTest(accounts);

        const [beforeUnstaked, beforeStaked, beforeUnstakedMint, beforeStakedMint, beforeUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        const ixBuilder = program.methods
            .collect()
            .accounts({
                userWallet: user.publicKey,
                userStakedTokenAccount: userStakedAta,
                userUnstakedTokenAccount: userUnstakedAta,
            })
            .signers([user]);
        const _sig = await ixBuilder.rpc();

        // Verify no error and state remains consistent
        const [afterUnstaked, afterStaked, afterUnstakedMint, afterStakedMint, afterUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        // With zero staked principal and no verification UBI, collect should mint 0
        expect(afterUnstaked.amount).to.equal(beforeUnstaked.amount);
        expect(afterStaked.amount).to.equal(beforeStaked.amount);
        expect(afterUnstakedMint.supply).to.equal(beforeUnstakedMint.supply);
        expect(afterStakedMint.supply).to.equal(beforeStakedMint.supply);

        // last_claimed should be updated to normalized today
        expect(beforeUserData.lastClaimedTimestamp.toNumber()).to.be.lessThan(
            afterUserData.lastClaimedTimestamp.toNumber(),
        );
        expect(afterUserData.lastClaimedTimestamp.toNumber()).to.equal(normalizeTime(new Date()).getTime() / 1000);
    });

    it("claims nothing when not staked and unverified", async () => {
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
            createUserDataAddedAccount({ userPubkey: user.publicKey, lastClaimed: weekAgo }),
            createGlobalDataAddedAccount({
                historicDistributions: {
                    position: 1,
                    buffer: [{ yieldRate: 1.5, ubiYield: 10 }],
                },
            }),
            createStakedMintAddedAccount(),
            createUnstakedMintAddedAccount(),
            createStakedTokenAccountAddedAccount({ owner: user.publicKey, amount: 0 }),
            createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 5 }),
        ]);

        const { provider, program } = await prepareTest(accounts);

        const [beforeUnstaked, beforeStaked, beforeUnstakedMint, beforeStakedMint, beforeUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        const ixBuilder = program.methods
            .collect()
            .accounts({
                userWallet: user.publicKey,
                userStakedTokenAccount: userStakedAta,
                userUnstakedTokenAccount: userUnstakedAta,
            })
            .signers([user]);
        const _sig = await ixBuilder.rpc();

        // Verify no error and state remains consistent
        const [afterUnstaked, afterStaked, afterUnstakedMint, afterStakedMint, afterUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        // With zero staked principal and no verification UBI, collect should mint 0
        expect(afterUnstaked.amount).to.equal(beforeUnstaked.amount);
        expect(afterStaked.amount).to.equal(beforeStaked.amount);
        expect(afterUnstakedMint.supply).to.equal(beforeUnstakedMint.supply);
        expect(afterStakedMint.supply).to.equal(beforeStakedMint.supply);

        // last_claimed should be updated to normalized today
        expect(beforeUserData.lastClaimedTimestamp.toNumber()).to.be.lessThan(
            afterUserData.lastClaimedTimestamp.toNumber(),
        );
        expect(afterUserData.lastClaimedTimestamp.toNumber()).to.equal(normalizeTime(new Date()).getTime() / 1000);
    });

    it("claims rewards when staked, but unverified", async function () {
        console.log("starting ", this.currentTest?.title);
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

        console.log("Preparing accounts for test...");

        const accounts = await Promise.all([
            createUserDataAddedAccount({ userPubkey: user.publicKey, lastClaimed: weekAgo }),
            createGlobalDataAddedAccount({
                historicDistributions: {
                    position: 1,
                    buffer: [{ yieldRate: 0.5, ubiYield: 10 }],
                },
            }),
            createStakedMintAddedAccount(),
            createUnstakedMintAddedAccount(),
            createStakedTokenAccountAddedAccount({ owner: user.publicKey, amount: 2 }),
            createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 5 }),
        ]);

        const { provider, program } = await prepareTest(accounts);

        console.log("getting before state...");

        const [beforeUnstaked, beforeStaked, beforeUnstakedMint, beforeStakedMint, beforeUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        console.log("invoking collect...");

        const ixBuilder = program.methods
            .collect()
            .accounts({
                userWallet: user.publicKey,
                userStakedTokenAccount: userStakedAta,
                userUnstakedTokenAccount: userUnstakedAta,
            })
            .signers([user]);
        const _sig = await ixBuilder.rpc();

        console.log("getting after state...");

        // Verify no error and state remains consistent
        const [afterUnstaked, afterStaked, afterUnstakedMint, afterStakedMint, afterUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        console.log("verifying results...");

        // With zero staked principal and no verification UBI, collect should mint 0
        expect(afterUnstaked.amount).to.equal(
            beforeUnstaked.amount + BigInt(Math.floor(Number(beforeStaked.amount) * 0.5)),
        );
        expect(afterStaked.amount).to.equal(beforeStaked.amount);
        expect(afterUnstakedMint.supply).to.equal(beforeUnstakedMint.supply + 1n);
        expect(afterStakedMint.supply).to.equal(beforeStakedMint.supply);

        // last_claimed should be updated to normalized today
        expect(beforeUserData.lastClaimedTimestamp.toNumber()).to.be.lessThan(
            afterUserData.lastClaimedTimestamp.toNumber(),
        );
        expect(afterUserData.lastClaimedTimestamp.toNumber()).to.equal(normalizeTime(new Date()).getTime() / 1000);
        console.log("✓ collect with staked but unverified user works as expected");
    });

    it("claims rewards when unstaked but verified", async () => {
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
            createUserDataAddedAccount({ userPubkey: user.publicKey, lastClaimed: weekAgo, lastVerified: weekAgo }),
            createGlobalDataAddedAccount({
                historicDistributions: {
                    position: 1,
                    buffer: [{ yieldRate: 0.5, ubiYield: 10 }],
                },
            }),
            createStakedMintAddedAccount(),
            createUnstakedMintAddedAccount(),
            createStakedTokenAccountAddedAccount({ owner: user.publicKey, amount: 0 }),
            createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 5 }),
        ]);

        const { provider, program } = await prepareTest(accounts);

        const [beforeUnstaked, beforeStaked, beforeUnstakedMint, beforeStakedMint, beforeUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        const ixBuilder = program.methods
            .collect()
            .accounts({
                userWallet: user.publicKey,
                userStakedTokenAccount: userStakedAta,
                userUnstakedTokenAccount: userUnstakedAta,
            })
            .signers([user]);
        const _sig = await ixBuilder.rpc();

        // Verify no error and state remains consistent
        const [afterUnstaked, afterStaked, afterUnstakedMint, afterStakedMint, afterUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        // With no staked principal but verified UBI, collect should mint UBI yield
        expect(afterUnstaked.amount).to.equal(beforeUnstaked.amount + 10n);
        expect(afterStaked.amount).to.equal(beforeStaked.amount);
        expect(afterUnstakedMint.supply).to.equal(beforeUnstakedMint.supply + 10n);
        expect(afterStakedMint.supply).to.equal(beforeStakedMint.supply);
        // last_claimed should be updated to normalized today
        expect(beforeUserData.lastClaimedTimestamp.toNumber()).to.be.lessThan(
            afterUserData.lastClaimedTimestamp.toNumber(),
        );
        expect(afterUserData.lastClaimedTimestamp.toNumber()).to.equal(normalizeTime(new Date()).getTime() / 1000);
    });

    it("claims rewards when staked and verified", async () => {
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
            createUserDataAddedAccount({ userPubkey: user.publicKey, lastClaimed: weekAgo, lastVerified: weekAgo }),
            createGlobalDataAddedAccount({
                historicDistributions: {
                    position: 1,
                    buffer: [{ yieldRate: 0.5, ubiYield: 10 }],
                },
            }),
            createStakedMintAddedAccount(),
            createUnstakedMintAddedAccount(),
            createStakedTokenAccountAddedAccount({ owner: user.publicKey, amount: 2 }),
            createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 5 }),
        ]);

        const { provider, program } = await prepareTest(accounts);

        const [beforeUnstaked, beforeStaked, beforeUnstakedMint, beforeStakedMint, beforeUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        const ixBuilder = program.methods
            .collect()
            .accounts({
                userWallet: user.publicKey,
                userStakedTokenAccount: userStakedAta,
                userUnstakedTokenAccount: userUnstakedAta,
            })
            .signers([user]);
        const _sig = await ixBuilder.rpc();

        // Verify no error and state remains consistent
        const [afterUnstaked, afterStaked, afterUnstakedMint, afterStakedMint, afterUserData] = await Promise.all([
            getAccount(provider.connection, userUnstakedAta),
            getAccount(provider.connection, userStakedAta),
            getMint(provider.connection, unstakedMintPda),
            getMint(provider.connection, stakedMintPda),
            program.account.userData.fetch(userDataPda),
        ]);

        // With no staked principal but verified UBI, collect should mint UBI yield
        expect(afterUnstaked.amount).to.equal(beforeUnstaked.amount + 11n);
        expect(afterStaked.amount).to.equal(beforeStaked.amount);
        expect(afterUnstakedMint.supply).to.equal(beforeUnstakedMint.supply + 11n);
        expect(afterStakedMint.supply).to.equal(beforeStakedMint.supply);
        // last_claimed should be updated to normalized today
        expect(beforeUserData.lastClaimedTimestamp.toNumber()).to.be.lessThan(
            afterUserData.lastClaimedTimestamp.toNumber(),
        );
        expect(afterUserData.lastClaimedTimestamp.toNumber()).to.equal(normalizeTime(new Date()).getTime() / 1000);
    });

    // TODO: add more tests for edge cases, failures, etc.
    // Core temporal edge cases
    it.skip("claims nothing when already claimed today", () => {});
    it.skip("prevents double claim within same normalized period", () => {});
    it.skip("fails when last claimed timestamp is in the future", () => {});

    // Distribution aggregation scenarios
    it.skip("aggregates rewards across multiple historic distributions since last claim", () => {});
    it.skip("claims only new distributions after previous collect", () => {});
    it.skip("ignores distributions before last claimed timestamp", () => {});
    it.skip("does not mint negative rewards when distribution yields decrease", () => {});
    it.skip("aggregates rewards accross max historic distributions", () => {});

    // Verification / staking permutations beyond existing single-buffer examples
    it.skip("mints only UBI when verified with zero staked amount across multiple distributions", () => {});
    it.skip("mints both yield and UBI across multiple distributions with mixed rates", () => {});

    // Rounding & math edge cases
    it.skip("rounds down fractional yield correctly for various principal sizes", () => {});
    it.skip("handles large staked amount without overflow", () => {});

    // Failure / validation cases
    it.skip("fails when user data account missing", () => {});
    it.skip("fails when user wallet signer is wrong", () => {});
    it.skip("fails when provided token accounts are not owned by user", () => {});
    it.skip("updates last claimed and mints nothing when global distribution buffer empty", () => {});
});
