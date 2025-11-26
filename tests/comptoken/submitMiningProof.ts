import crypto from "crypto";

import {
    ComptokenProof,
    getUnstakedMintAddress,
    getUserUnstakedAssociatedTokenAddress,
    submitMiningProof,
} from "@compto/comptoken.js";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";

import {
    baseProgram,
    createGlobalDataAddedAccount,
    createUnstakedMintAddedAccount,
    createUnstakedTokenAccountAddedAccount,
    createUserDataAddedAccount,
    getAccount,
    getMint,
} from "./utils/accountPreinitHelpers.ts";
import { fetchGlobalData, fetchUserData } from "./utils/stateHelpers.ts";
import { prepareTest } from "./utils/utils.ts";

describe("submit_mining_proof", () => {
    const user = Keypair.fromSeed(
        // prettier-ignore
        Uint8Array.from([163, 81, 164, 86, 62, 89, 43, 120, 231, 223, 81, 41, 255, 0, 3, 98, 151, 236, 77, 132, 181, 2, 19, 112, 35, 17, 2, 37, 237, 5, 249, 54,]),
    );
    const validBlockhash = Uint8Array.from(Array.from({ length: 32 }).map((_, i) => i));

    const proof = new ComptokenProof({
        pubkey: user.publicKey,
        recentBlockHash: validBlockhash,
        extraData: Uint8Array.from(Array.from({ length: 32 }).map(() => 0)),
        nonce: 33,
        version: 0,
        timestamp: 0,
        target: ComptokenProof.TARGET_BYTES_DEVNET,
    });

    describe("Core success path scenarios", () => {
        it("mints MINING_REWARD_AMOUNT into user's unstaked token account for a valid proof when user_data is current", async function () {
            const unstakedMintPda = getUnstakedMintAddress(baseProgram);
            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const accounts = await Promise.all([
                // user_data must be current and have spare proofs capacity
                createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                createGlobalDataAddedAccount({ validBlockhash }),
                createUnstakedMintAddedAccount(),
                createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 0 }),
            ]);

            const { provider, program } = await prepareTest(accounts);

            const [beforeUserUnstaked, beforeUnstakedMint] = await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getMint(provider.connection, unstakedMintPda),
            ]);

            await submitMiningProof({ program, proof, accounts: { userWallet: user } });

            const [afterUserUnstaked, afterUnstakedMint] = await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getMint(provider.connection, unstakedMintPda),
            ]);

            const reward = baseProgram.constants.miningRewardAmount;
            expect(Number(afterUserUnstaked.amount - beforeUserUnstaked.amount)).to.equal(reward.toNumber());
            expect(Number(afterUnstakedMint.supply - beforeUnstakedMint.supply)).to.equal(reward.toNumber());
        });

        it("increments global total_mined_today by MINING_REWARD_AMOUNT on success", async function () {
            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                createGlobalDataAddedAccount({ validBlockhash, totalMinedToday: 1234 }),
                createUnstakedMintAddedAccount(),
                createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 0 }),
            ]);
            const { program } = await prepareTest(accounts);

            const beforeGlobal = await fetchGlobalData(program);

            await submitMiningProof({ program, proof, accounts: { userWallet: user } });

            const afterGlobal = await fetchGlobalData(program);
            const reward = Number(baseProgram.constants.miningRewardAmount);
            expect(afterGlobal.dailyDistribution.totalMinedToday.toNumber()).to.equal(
                beforeGlobal.dailyDistribution.totalMinedToday.toNumber() + reward,
            );
        });

        it("stores parsed proof hash and recent blockhash in user_data", async function () {
            const expectedFinal = proof.hash;

            console.log("Expected final hash:", Buffer.from(expectedFinal).toString("hex"));

            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                createGlobalDataAddedAccount({ validBlockhash }),
                createUnstakedMintAddedAccount(),
                createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 0 }),
            ]);

            const { program } = await prepareTest(accounts);

            await submitMiningProof({ program, proof, accounts: { userWallet: user } });

            const userData = await fetchUserData(program, user.publicKey);
            // recent_blockhash should equal what we set
            expect(Uint8Array.from(userData.recentBlockhash[0])).to.deep.equal(Uint8Array.from(validBlockhash));
            // proofs should contain our mined final hash as first element
            const storedProof0: Uint8Array = Uint8Array.from(userData.proofs[0][0]);
            expect(Buffer.from(storedProof0).equals(Buffer.from(expectedFinal))).to.equal(true);
        });

        it("accepts consecutive valid proofs under the same recent blockhash until capacity is reached", async function () {
            const nonces = [33, 77, 80];
            const capacity = nonces.length;

            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey, capacity, proofs: [] }),
                createGlobalDataAddedAccount({ validBlockhash }),
                createUnstakedMintAddedAccount(),
                createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 0 }),
            ]);

            const { program, provider } = await prepareTest(accounts);

            const reward = baseProgram.constants.miningRewardAmount;
            const before = await getAccount(provider.connection, userUnstakedAta);

            let successful = 0;
            for (; successful < capacity; successful++) {
                const p = new ComptokenProof({
                    pubkey: proof.pubkey,
                    recentBlockHash: proof.recentBlockHash,
                    extraData: proof.extraData,
                    nonce: nonces[successful],
                    version: proof.version,
                    timestamp: proof.timestamp,
                });

                await submitMiningProof({
                    program,
                    proof: p,
                    accounts: { userWallet: user },
                });
            }

            const after = await getAccount(provider.connection, userUnstakedAta);
            expect(Number(after.amount - before.amount)).to.equal(reward.toNumber() * successful);

            const userData = await fetchUserData(program, user.publicKey);
            // proofs length should equal number of successful submissions
            expect(userData.proofs.length).to.equal(successful);
            // recent_blockhash should remain the same
            expect(Uint8Array.from(userData.recentBlockhash[0])).to.deep.equal(Uint8Array.from(validBlockhash));
        });
    });

    describe("Proof storage behavior", () => {
        it("clears previous proofs when recent blockhash changes and inserts new proof", async function () {
            // Old blockhash (what user_data has) and new valid blockhash (what global_data has)
            const oldBlockhash = Uint8Array.from(Array.from({ length: 32 }).map((_, i) => 2 * i));

            // Seed user_data with some existing proofs that should be cleared
            const existingProofs = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), new Uint8Array(32).fill(3)];

            const expectedFinal = proof.hash;

            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const accounts = await Promise.all([
                createUserDataAddedAccount({
                    userPubkey: user.publicKey,
                    capacity: 10,
                    recentBlockhash: oldBlockhash,
                    proofs: existingProofs,
                }),
                createGlobalDataAddedAccount({ validBlockhash: proof.recentBlockHash }),
                createUnstakedMintAddedAccount(),
                createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 0 }),
            ]);

            const { program } = await prepareTest(accounts);

            await submitMiningProof({ program, proof, accounts: { userWallet: user } });

            const userData = await fetchUserData(program, user.publicKey);
            // Should clear old proofs and insert exactly one new proof
            expect(userData.proofs.length).to.equal(1);
            const storedProof0 = Buffer.from(userData.proofs[0][0]);
            expect(storedProof0.equals(expectedFinal)).to.equal(true);
            // recent_blockhash should update to newBlockhash
            expect(Uint8Array.from(userData.recentBlockhash[0])).to.deep.equal(proof.recentBlockHash);
        });

        it("prevents inserting the same proof twice (DuplicateMiningProof)", async function () {
            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey, capacity: 5, proofs: [] }),
                createGlobalDataAddedAccount({ validBlockhash }),
                createUnstakedMintAddedAccount(),
                createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 0 }),
            ]);
            const { program } = await prepareTest(accounts);

            // First submission should succeed
            await submitMiningProof({ program, proof, accounts: { userWallet: user } });

            // Second, identical submission should fail with DuplicateMiningProof
            let threw = false;
            try {
                await submitMiningProof({ program, proof, accounts: { userWallet: user } });
            } catch (err: any) {
                threw = true;
                const msg = (err?.error?.errorMessage ?? err?.toString() ?? "").toLowerCase();
                expect(
                    msg.includes("duplicate mining proof") || msg.includes("duplicateminingproof"),
                    `Expected DuplicateMiningProof error, got: ${msg}`,
                ).to.be.true;
            }
            expect(threw, "Second identical proof should be rejected").to.be.true;
        });

        it("fails when user_data.proofs capacity is exceeded (UserDataProofsCapacityExceeded)", async function () {
            // Fill user_data proofs to capacity under the SAME blockhash so appending should fail
            const prefilledProofs = [new Uint8Array(32).fill(7), new Uint8Array(32).fill(8)];

            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const accounts = await Promise.all([
                createUserDataAddedAccount({
                    userPubkey: user.publicKey,
                    capacity: prefilledProofs.length,
                    recentBlockhash: validBlockhash,
                    proofs: prefilledProofs,
                }),
                createGlobalDataAddedAccount({ validBlockhash }),
                createUnstakedMintAddedAccount(),
                createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 0 }),
            ]);
            const { program } = await prepareTest(accounts);

            let threw = false;
            try {
                await submitMiningProof({ program, proof, accounts: { userWallet: user } });
            } catch (err: any) {
                threw = true;
                const msg = (err?.error?.errorMessage ?? err?.toString() ?? "").toLowerCase();
                expect(
                    msg.includes("user data proofs capacity exceeded") ||
                        msg.includes("userdataproofscapacityexceeded"),
                    `Expected UserDataProofsCapacityExceeded error, got: ${msg}`,
                ).to.be.true;
            }
            expect(threw, "Submitting beyond capacity should be rejected").to.be.true;
        });
    });

    describe("Failure / validation scenarios", () => {
        it.skip("fails with UserDataNotCurrent when user_data.last_claimed_timestamp is not today", () => {});
        it.skip("fails with InvalidMiningProof when hash does not meet target difficulty", () => {});
        it.skip("fails with InvalidMiningProof when embedded pubkey in raw_data does not match signer (user_wallet)", () => {});
        it.skip("fails with StaleValidBlockhash when valid_blockhash_time is older than 24h", () => {});
        it.skip("fails when user_unstaked_token_account mint doesn't match unstaked_mint", () => {});
        it.skip("fails when user_unstaked_token_account is not owned by user_wallet", () => {});
        it.skip("fails when unstaked_mint PDA is missing", () => {});
        it.skip("fails when global_data PDA is missing", () => {});
        it.skip("fails when user_data PDA is missing", () => {});
        it.skip("fails when any PDA is provided with incorrect seeds (address mismatch)", () => {});
        it.skip("does not mint or increment total_mined_today on any failure path", () => {});
    });

    describe("Minting and accounting", () => {
        it.skip("does not mint to staked mint and does not alter staked balances", () => {});
        it.skip("uses global_data as mint authority via signer seeds for mint_to_checked", () => {});
        it.skip("does not overflow total_mined_today on repeated successful proofs (bigint safe)", () => {});
    });

    describe("Edge cases", () => {
        it.skip("accepts boundary-difficulty proofs exactly below target and rejects exactly at/above target", () => {});
        it.skip("handles change of valid_blockhashes between submissions within the same day", () => {});
        it.skip("tolerates arbitrary extra_data/pubkey values as long as hash meets difficulty", () => {});
        it.skip("rejects proofs with malformed raw_data (wrong length or corrupt slices)", () => {});
    });
});
