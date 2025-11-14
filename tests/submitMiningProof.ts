import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import crypto from "crypto";

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

// --- Local helpers to mirror on-chain hashing exactly ---
function doubleSha256(parts: Uint8Array[]): Uint8Array {
    const h1 = crypto.createHash("sha256");
    for (const p of parts) h1.update(p);
    const first = h1.digest();
    const h2 = crypto.createHash("sha256");
    h2.update(first);
    return new Uint8Array(h2.digest());
}

function reverseBytes(b: Uint8Array): Uint8Array {
    return Uint8Array.from(Array.from(b).reverse());
}

function buildHeader({
    version,
    validBlockhash,
    merkleRoot,
    timestamp,
    nonce,
}: {
    version: number[];
    validBlockhash: Uint8Array; // 32 bytes (little-endian expected by program after reverse)
    merkleRoot: Uint8Array; // 32 bytes
    timestamp: number[]; // 4 bytes
    nonce: number[]; // 4 bytes
}): Uint8Array {
    const nbits = Uint8Array.from([0xd8, 0xad, 0x0e, 0x18]);
    // Program reverses valid_blockhash bytes before composing header
    const bh = reverseBytes(validBlockhash);
    const parts = [version, bh, merkleRoot, timestamp, nbits, nonce];
    const len = parts.reduce((a, p) => a + p.length, 0);
    if (len !== 80) throw new Error(`header size mismatch: ${len}`);
    const out = new Uint8Array(80);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

function computeFinalHash(header: Uint8Array): Uint8Array {
    const h = doubleSha256([header]);
    return reverseBytes(h);
}

function merkleRoot(extraData: Uint8Array, pubkey: Uint8Array): Uint8Array {
    return doubleSha256([extraData, pubkey]);
}

describe.only("submit_mining_proof", () => {
    describe("Core success path scenarios", () => {
        it("mints MINING_REWARD_AMOUNT into user's unstaked token account for a valid proof when user_data is current", async function () {
            const user = Keypair.fromSeed(
                // prettier-ignore
                Uint8Array.from([
                    // arbitrary but fixed for test stability
                    163, 81,  164, 86,  62,  89,  43,  120, 231, 223, 81,  41,  255, 0,   3,   98,
                    151, 236, 77,  132, 181, 2,   19,  112, 35,  17,  2,   37,  237, 5,   249, 54,
                ]),
            );
            const validBlockhash = Uint8Array.from(Array.from({ length: 32 }).map((_, i) => i));
            const extraData = Array.from({ length: 32 }).map(() => 0);
            // prettier-ignore
            const rawData = [
                ...user.publicKey.toBuffer(),
                ...extraData,
                3, 0, 0, 0, // nonce
                0, 0, 0, 32, // mostly arbitrary version
                0, 0, 0, 0, // can be arbitrary, for compatibility with bitcoin mining, effectively another nonce
            ];

            const [unstakedMintPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(baseProgram.constants.unstakedMintSeed)],
                baseProgram.programId,
            );

            const userUnstakedAta = getAssociatedTokenAddressSync(
                unstakedMintPda,
                user.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID,
            );

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

            await program.methods
                .submitMiningProof({ rawData })
                .accounts({ userWallet: user.publicKey, userUnstakedTokenAccount: userUnstakedAta })
                .signers([user])
                .rpc();

            const [afterUserUnstaked, afterUnstakedMint] = await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getMint(provider.connection, unstakedMintPda),
            ]);

            const reward = baseProgram.constants.miningRewardAmount;
            expect(Number(afterUserUnstaked.amount - beforeUserUnstaked.amount)).to.equal(reward.toNumber());
            expect(Number(afterUnstakedMint.supply - beforeUnstakedMint.supply)).to.equal(reward.toNumber());
        });

        it("increments global total_mined_today by MINING_REWARD_AMOUNT on success", async function () {
            const user = Keypair.fromSeed(
                // prettier-ignore
                Uint8Array.from([
                    // arbitrary but fixed for test stability
                    163, 81,  164, 86,  62,  89,  43,  120, 231, 223, 81,  41,  255, 0,   3,   98,
                    151, 236, 77,  132, 181, 2,   19,  112, 35,  17,  2,   37,  237, 5,   249, 54,
                ]),
            );
            const validBlockhash = Uint8Array.from(Array.from({ length: 32 }).map((_, i) => i));
            const extraData = Array.from({ length: 32 }).map(() => 0);
            // prettier-ignore
            const rawData = [
                ...user.publicKey.toBuffer(),
                ...extraData,
                3, 0, 0, 0, // nonce
                0, 0, 0, 32, // mostly arbitrary version
                0, 0, 0, 0, // can be arbitrary, for compatibility with bitcoin mining, effectively another nonce
            ];

            const [unstakedMintPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(baseProgram.constants.unstakedMintSeed)],
                baseProgram.programId,
            );
            const userUnstakedAta = getAssociatedTokenAddressSync(
                unstakedMintPda,
                user.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID,
            );

            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                createGlobalDataAddedAccount({ validBlockhash, totalMinedToday: 1234 }),
                createUnstakedMintAddedAccount(),
                createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 0 }),
            ]);
            const { program } = await prepareTest(accounts);

            const beforeGlobal = await fetchGlobalData(program);

            await program.methods
                .submitMiningProof({ rawData })
                .accounts({ userWallet: user.publicKey, userUnstakedTokenAccount: userUnstakedAta })
                .signers([user])
                .rpc();

            const afterGlobal = await fetchGlobalData(program);
            const reward = Number(baseProgram.constants.miningRewardAmount);
            expect(afterGlobal.dailyDistribution.totalMinedToday.toNumber()).to.equal(
                beforeGlobal.dailyDistribution.totalMinedToday.toNumber() + reward,
            );
        });

        it("stores parsed proof hash and recent blockhash in user_data", async function () {
            const user = Keypair.fromSeed(
                // prettier-ignore
                Uint8Array.from([
                    // arbitrary but fixed for test stability
                    163, 81,  164, 86,  62,  89,  43,  120, 231, 223, 81,  41,  255, 0,   3,   98,
                    151, 236, 77,  132, 181, 2,   19,  112, 35,  17,  2,   37,  237, 5,   249, 54,
                ]),
            );
            const validBlockhash = Uint8Array.from(Array.from({ length: 32 }).map((_, i) => i));
            const extraData = Array.from({ length: 32 }).map(() => 0);
            // prettier-ignore
            const rawData = [
                ...user.publicKey.toBuffer(),
                ...extraData,
                3, 0, 0, 0,
                0, 0, 0, 32, // mostly arbitrary version
                0, 0, 0, 0, // can be arbitrary, for compatibility with bitcoin mining, effectively another nonce
            ];

            // Recompute final hash for the pre-seeded vector and compare (use pubkey from rawData)
            const nonce = rawData.slice(64, 68);
            const version = rawData.slice(68, 72);
            const timestamp = rawData.slice(72, 76);
            const mr = merkleRoot(Uint8Array.from(extraData), user.publicKey.toBytes());
            const header = buildHeader({ version, validBlockhash, merkleRoot: mr, timestamp, nonce });
            const expectedFinal = computeFinalHash(header);

            console.log("Expected final hash:", Buffer.from(expectedFinal).toString("hex"));

            const [unstakedMintPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(baseProgram.constants.unstakedMintSeed)],
                baseProgram.programId,
            );
            const userUnstakedAta = getAssociatedTokenAddressSync(
                unstakedMintPda,
                user.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID,
            );

            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                createGlobalDataAddedAccount({ validBlockhash }),
                createUnstakedMintAddedAccount(),
                createUnstakedTokenAccountAddedAccount({ address: userUnstakedAta, owner: user.publicKey, amount: 0 }),
            ]);

            const { program } = await prepareTest(accounts);

            await program.methods
                .submitMiningProof({ rawData })
                .accounts({ userWallet: user.publicKey, userUnstakedTokenAccount: userUnstakedAta })
                .signers([user])
                .rpc();

            const userData = await fetchUserData(program, user.publicKey);
            // recent_blockhash should equal what we set
            expect(Uint8Array.from(userData.recentBlockhash[0])).to.deep.equal(Uint8Array.from(validBlockhash));
            // proofs should contain our mined final hash as first element
            const storedProof0: Uint8Array = Uint8Array.from(userData.proofs[0][0]);
            expect(Buffer.from(storedProof0).equals(Buffer.from(expectedFinal))).to.equal(true);
        });

        it("accepts consecutive valid proofs under the same recent blockhash until capacity is reached", async function () {
            const user = Keypair.fromSeed(
                // prettier-ignore
                Uint8Array.from([
                    // arbitrary but fixed for test stability
                    163, 81,  164, 86,  62,  89,  43,  120, 231, 223, 81,  41,  255, 0,   3,   98,
                    151, 236, 77,  132, 181, 2,   19,  112, 35,  17,  2,   37,  237, 5,   249, 54,
                ]),
            );
            const validBlockhash = Uint8Array.from(Array.from({ length: 32 }).map((_, i) => i));
            const extraData = Array.from({ length: 32 }).map(() => 0);
            function makeRawDataWithNonce(nonceNum: number): number[] {
                const buf = Buffer.alloc(4);
                buf.writeUInt32LE(nonceNum, 0);
                // prettier-ignore
                return [
                    ...user.publicKey.toBuffer(),
                    ...extraData,
                    ...buf,
                    0, 0, 0, 32, // mostly arbitrary version
                    0, 0, 0, 0, // can be arbitrary, for compatibility with bitcoin mining, effectively another nonce
                ];
            }

            const nonces = [3, 4, 5];
            const capacity = nonces.length;

            const [unstakedMintPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(baseProgram.constants.unstakedMintSeed)],
                baseProgram.programId,
            );
            const userUnstakedAta = getAssociatedTokenAddressSync(
                unstakedMintPda,
                user.publicKey,
                false,
                TOKEN_2022_PROGRAM_ID,
            );

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
                await program.methods
                    .submitMiningProof({ rawData: makeRawDataWithNonce(nonces[successful]) })
                    .accounts({ userWallet: user.publicKey, userUnstakedTokenAccount: userUnstakedAta })
                    .signers([user])
                    .rpc();
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
        it.skip("clears previous proofs when recent blockhash changes and inserts new proof", () => {});
        it.skip("prevents inserting the same proof twice (DuplicateMiningProof)", () => {});
        it.skip("fails when user_data.proofs capacity is exceeded (UserDataProofsCapacityExceeded)", () => {});
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
