import { addresses, transactions } from "@compto/comptoken.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
const { getUnstakedMintAddress, getUserUnstakedAssociatedTokenAddress } = addresses;
const { reverify, unverifyWithProofRecovery, unverifyWithWalletSignature, verify } = transactions;

import type { AddedAccount } from "solana-bankrun";
import {
    baseProgram,
    buildWorldIdAccountsForVerify,
    buildWorldIdAccountsWithNullifier,
    coder,
    createGlobalDataAddedAccount,
    createUnstakedMintAddedAccount,
    createUnstakedTokenAccountAddedAccount,
    createUserDataAddedAccount,
    createWalletAddedAccount,
    getAccount,
    getMint,
    getWorldIdNullifierPda,
} from "./utils/accountPreinitHelpers.ts";
import { fetchGlobalData, fetchUserData } from "./utils/stateHelpers.ts";
import { prepareTest } from "./utils/utils.ts";

describe("verification", () => {
    const user = Keypair.fromSeed(new Uint8Array(32).fill(0x01));

    describe("Verify (World ID)", () => {
        const worldIdFixture = (() => {
            // appId:  "app_6599964a29641e47c6f38c562da0628d"
            // action: "verifyhuman"
            // signal: user wallet address hex + "verify"
            const proofHex =
                "0x" +
                "0f8c9f4db39d5615ad433d835c8c332ffcf52e11a670d8112c1df4286c591bb2" +
                "24634696cc84f79aefc11d916135aee1338d47022ee682e318fe8450aed17e8f" +
                "15a174e9bb65a792a901c4436fbe4885bccbc3758d15acb29147c14d1f33b172" +
                "106b989e11a7afc735951837256861f6829ccc53bec97d5923685bab98826efe" +
                "2f93d6eda999b0831fd7380e181d4dfb531b3130fa383f1832cebf5aeabed4c7" +
                "03b561921884a7dbb0af623b70ab5987181452bbbb8f35db384da3ecf78730c2" +
                "1876f4490d163fcd69fb72d9f720626e0a8758d9f72f09ae881d967cd2fe5fd6" +
                "18fb01ebf86d1f225d8e7969a5389edb8efe2600409fcae1b487a1fdee8014e9";

            const rootHex = "0x17042ce814bfae374b947cd5278815aaef3ee2ff35f08f74444f1a3d3cfae06e";
            const nullifierHex = "0x00fdc9448b89970a2316edc0c161ab169c3b0881263754e420ce6fa030a0b90b";
            //signal_hash: "0x0077b06b7357c3bc09b0c0e044343af5ab5a49347b2bf4ac128afbf9419d6ac0",

            return {
                proof: Buffer.from(proofHex.replace("0x", ""), "hex"),
                rootHash: Buffer.from(rootHex.replace("0x", ""), "hex"),
                nullifierHash: Buffer.from(nullifierHex.replace("0x", ""), "hex"),
            } as const;
        })();

        describe("Core success path scenarios", () => {
            it("verifies a valid World ID proof and sets nullifier_hash in user_data", async () => {
                // PDAs used by instruction / assertions
                const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

                // Seed on-chain state required for verify
                const accounts: AddedAccount[] = [
                    await createWalletAddedAccount(user.publicKey),
                    await createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                    await createGlobalDataAddedAccount(),
                    await createUnstakedMintAddedAccount(),
                    await createUnstakedTokenAccountAddedAccount({
                        address: userUnstakedAta,
                        owner: user.publicKey,
                        amount: 0,
                    }),
                    ...(await buildWorldIdAccountsForVerify({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                    })),
                ];

                const { program, solanaWorldIdProgram } = await prepareTest(accounts);

                // Call verify
                await verify({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        userWallet: user,
                    },
                });

                const userData = await fetchUserData(program, user.publicKey);
                expect(Uint8Array.from(userData.verification.nullifier!.hash[0])).to.deep.equal(
                    Uint8Array.from(worldIdFixture.nullifierHash),
                );
            });

            it("mints per-capita early adopter UBI to user's unstaked token account when remaining_early_adopter_count > 0", async () => {
                const perCapita = 12345; // arbitrary test value

                const unstakedMintPda = getUnstakedMintAddress(baseProgram);
                const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

                const accounts = [
                    await createWalletAddedAccount(user.publicKey),
                    await createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                    await createGlobalDataAddedAccount({
                        perCapitaEarlyAdopterUbiAmount: perCapita,
                        remainingEarlyAdopterCount: 5,
                        verifiedAccountsCount: 0,
                    }),
                    await createUnstakedMintAddedAccount(),
                    await createUnstakedTokenAccountAddedAccount({
                        address: userUnstakedAta,
                        owner: user.publicKey,
                        amount: 0,
                    }),
                    ...(await buildWorldIdAccountsForVerify({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                    })),
                ];

                const { provider, program, solanaWorldIdProgram } = await prepareTest(accounts);

                const [beforeUserUnstaked, beforeMint] = await Promise.all([
                    getAccount(provider.connection, userUnstakedAta),
                    getMint(provider.connection, unstakedMintPda),
                ]);

                await verify({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        userWallet: user,
                    },
                });

                const [afterUserUnstaked, afterMint] = await Promise.all([
                    getAccount(provider.connection, userUnstakedAta),
                    getMint(provider.connection, unstakedMintPda),
                ]);

                expect(Number(afterUserUnstaked.amount - beforeUserUnstaked.amount)).to.equal(perCapita);
                expect(Number(afterMint.supply - beforeMint.supply)).to.equal(perCapita);
            });

            it("increments verified_accounts_count and decrements remaining_early_adopter_count on success", async () => {
                const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

                const accounts = [
                    await createWalletAddedAccount(user.publicKey),
                    await createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                    await createGlobalDataAddedAccount({
                        perCapitaEarlyAdopterUbiAmount: 1, // non-zero to allow mint if applicable
                        verifiedAccountsCount: 7,
                    }),
                    await createUnstakedMintAddedAccount(),
                    await createUnstakedTokenAccountAddedAccount({
                        address: userUnstakedAta,
                        owner: user.publicKey,
                        amount: 0,
                    }),
                    ...(await buildWorldIdAccountsForVerify({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                    })),
                ];

                const { program, solanaWorldIdProgram } = await prepareTest(accounts);

                const before = await fetchGlobalData(program);
                const initialVerified = before.dailyDistribution.verifiedAccountsCount;
                const initialRemaining = before.dailyDistribution.remainingEarlyAdopterCount;

                await verify({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        userWallet: user,
                    },
                });

                const after = await fetchGlobalData(program);
                expect(after.dailyDistribution.verifiedAccountsCount).to.equal(initialVerified + 1);
                expect(after.dailyDistribution.remainingEarlyAdopterCount).to.equal(initialRemaining - 1);
            });

            it("does not mint early adopter UBI when remaining_early_adopter_count = 0", async () => {
                const perCapita = 12345; // arbitrary test value

                const unstakedMintPda = getUnstakedMintAddress(baseProgram);
                const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

                const accounts = [
                    await createWalletAddedAccount(user.publicKey),
                    await createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                    await createGlobalDataAddedAccount({
                        perCapitaEarlyAdopterUbiAmount: perCapita,
                        verifiedAccountsCount: 7,
                        remainingEarlyAdopterCount: 0,
                    }),
                    await createUnstakedMintAddedAccount(),
                    await createUnstakedTokenAccountAddedAccount({
                        address: userUnstakedAta,
                        owner: user.publicKey,
                        amount: 0,
                    }),
                    ...(await buildWorldIdAccountsForVerify({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                    })),
                ];

                const { provider, program, solanaWorldIdProgram } = await prepareTest(accounts);

                const [beforeUserUnstaked, beforeMint] = await Promise.all([
                    getAccount(provider.connection, userUnstakedAta),
                    getMint(provider.connection, unstakedMintPda),
                ]);

                const before = await fetchGlobalData(program);
                const initialVerified = before.dailyDistribution.verifiedAccountsCount;

                await verify({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        userWallet: user,
                    },
                });

                const [afterUserUnstaked, afterMint] = await Promise.all([
                    getAccount(provider.connection, userUnstakedAta),
                    getMint(provider.connection, unstakedMintPda),
                ]);

                expect(afterUserUnstaked.amount).to.equal(beforeUserUnstaked.amount);
                expect(afterMint.supply).to.equal(beforeMint.supply);

                const after = await fetchGlobalData(program);
                expect(after.dailyDistribution.verifiedAccountsCount).to.equal(initialVerified + 1);
                expect(after.dailyDistribution.remainingEarlyAdopterCount).to.equal(0);
            });

            it("sets nullifier owner to user_wallet on success", async () => {
                const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);
                const worldIdNullifierPda = getWorldIdNullifierPda(worldIdFixture.nullifierHash);

                const accounts = [
                    await createWalletAddedAccount(user.publicKey),
                    await createUserDataAddedAccount({ userPubkey: user.publicKey, proofs: [] }),
                    await createGlobalDataAddedAccount(),
                    await createUnstakedMintAddedAccount(),
                    await createUnstakedTokenAccountAddedAccount({
                        address: userUnstakedAta,
                        owner: user.publicKey,
                        amount: 0,
                    }),
                    ...(await buildWorldIdAccountsForVerify({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                    })),
                ];

                const { program, solanaWorldIdProgram } = await prepareTest(accounts);

                await verify({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        userWallet: user,
                    },
                });

                const nullifier = await program.account.nullifier.fetch(worldIdNullifierPda);
                expect(nullifier.userWallet.toBase58()).to.equal(user.publicKey.toBase58());
            });
        });

        describe("Failure / validation scenarios", () => {
            it.skip("fails with UserDataNotCurrent when user_data is stale", () => {});
            it.skip("fails with NullifierAlreadyUsed when nullifier was used", () => {});
            it.skip("fails when World ID proof is invalid", () => {});
            it.skip("fails when user_unstaked_token_account mint doesn't match unstaked_mint", () => {});
            it.skip("fails when user_unstaked_token_account is not owned by user_wallet", () => {});
            it.skip("fails when any PDA is provided with incorrect seeds (address mismatch)", () => {});
            it.skip("fails when unstaked_mint PDA is missing", () => {});
            it.skip("fails when global_data PDA is missing", () => {});
            it.skip("fails when user_data PDA is missing", () => {});
        });

        describe("Minting and accounting", () => {
            it.skip("does not mint early adopter UBI when remaining_early_adopter_count = 0", () => {});
            it.skip("uses signer seeds for mint authority when minting early adopter UBI", () => {});
            it.skip("does not modify total_mined_today or high_water_mark", () => {});
        });

        describe("Edge cases", () => {
            it.skip("handles maximum-size proof and boundary root/nullifier values", () => {});
        });
    });

    describe("Reverify (World ID)", () => {
        const worldIdFixture = (() => {
            // appId:  "app_6599964a29641e47c6f38c562da0628d"
            // action: "verifyhuman"
            // signal: user wallet address hex + "reverify"
            const proofHex =
                "0x" +
                "003dcb7fad733156e451b38e79eeb30960ba7a54c30e9c3144f1e24539c4542a" +
                "2d2a411f0f7e541f859670ab2b58e79de76fb41c3678b59767809e6e4380fb8e" +
                "2c493fce0d13b638ef2dde98ee63680622de3ad398e839adcbfe67c8d32e81d5" +
                "007ba465b103f1f805424815e0c9cb7343616f52f910629a00720c858bbf1567" +
                "0d854ae91b562ae7aea8754fe8991799126648d2586906288fe1f550ffe89811" +
                "2835a986c105af2e3635c9f576678a89680d656f7c8f48f8ecf7f8d4a6638949" +
                "26f04762efbb5c097e1303c6330d80da61ece76332510bf3f3c98cc5d61202eb" +
                "0f12759e450f606856473c26628d98b03cfaba57f53eaa305528531c0121c2fe";

            const rootHex = "0x0eaf6241c8a35811ddad3edab5fc35d9baf5b09391614062aa4d567f51499830";
            const nullifierHex = "0x00fdc9448b89970a2316edc0c161ab169c3b0881263754e420ce6fa030a0b90b";
            // signal_hash: "0x0081c84b3e2b5899372508f99482aaf819ed0e8d70792ca83ea509253c450f59",

            return {
                proof: Buffer.from(proofHex.replace("0x", ""), "hex"),
                rootHash: Buffer.from(rootHex.replace("0x", ""), "hex"),
                nullifierHash: Buffer.from(nullifierHex.replace("0x", ""), "hex"),
            } as const;
        })();

        describe("Core success path scenarios", () => {
            it("re-verifies under the same nullifier without requiring user_data to be current", async () => {
                // Seed on-chain state: user_data is stale (last_claimed not equal to today) but has nullifier set
                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        // make last_claimed old so `is_current()` is false
                        lastClaimed: new Date(0),
                        lastVerified: new Date(0),
                        verification: { Nullifier: { hash: { [0]: Array.from(worldIdFixture.nullifierHash) } } },
                        proofs: [],
                    }),
                    // world id PDAs + pre-created nullifier owned by program with correct owner set
                    ...(await buildWorldIdAccountsWithNullifier({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                        nullifierHash: worldIdFixture.nullifierHash,
                        program: baseProgram,
                    })),
                ];

                const { program, solanaWorldIdProgram } = await prepareTest(accounts);

                // Call reverify - should succeed even though user_data.is_current() === false
                await reverify({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        userWallet: user,
                    },
                });

                const userData = await fetchUserData(program, user.publicKey);
                // nullifier hash must remain set to the same value
                expect(Uint8Array.from(userData.verification.nullifier!.hash[0])).to.deep.equal(
                    Uint8Array.from(worldIdFixture.nullifierHash),
                );
            });

            it("binds a previously-verified but unbound nullifier to a new user wallet", async () => {
                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        lastClaimed: new Date(),
                        lastVerified: new Date(),
                        verification: { Nullifier: { hash: { [0]: Array.from(worldIdFixture.nullifierHash) } } },
                        proofs: [],
                    }),
                    ...(await buildWorldIdAccountsWithNullifier({
                        userWallet: PublicKey.default,
                        rootHash: worldIdFixture.rootHash,
                        nullifierHash: worldIdFixture.nullifierHash,
                        program: baseProgram,
                    })),
                ];

                const { program, solanaWorldIdProgram } = await prepareTest(accounts);

                await reverify({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        userWallet: user,
                    },
                });

                const worldIdNullifierPda = getWorldIdNullifierPda(worldIdFixture.nullifierHash);
                const conn = program.provider.connection;
                const info = await conn.getAccountInfo(worldIdNullifierPda, "confirmed");
                const decoded = coder.accounts.decode("Nullifier", info!.data);
                const ownerPk = new PublicKey(decoded.user_wallet);

                expect(ownerPk.toBase58()).to.equal(user.publicKey.toBase58());
            });

            it("fails with InvalidNullifierOwner when reverifying a bound identity with a different wallet", async () => {
                const otherWallet = Keypair.generate();

                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        lastClaimed: new Date(),
                        lastVerified: new Date(),
                        verification: { Nullifier: { hash: { [0]: Array.from(worldIdFixture.nullifierHash) } } },
                        proofs: [],
                    }),
                    ...(await buildWorldIdAccountsWithNullifier({
                        userWallet: otherWallet.publicKey,
                        rootHash: worldIdFixture.rootHash,
                        nullifierHash: worldIdFixture.nullifierHash,
                        program: baseProgram,
                    })),
                ];

                const { program, solanaWorldIdProgram } = await prepareTest(accounts);

                let threw = false;
                try {
                    await reverify({
                        program,
                        solanaWorldIdProgram,
                        rootHash: worldIdFixture.rootHash,
                        nullifierHash: worldIdFixture.nullifierHash,
                        proof: worldIdFixture.proof,
                        accounts: {
                            userWallet: user,
                        },
                    });
                } catch (err: any) {
                    threw = true;
                    const msg = (err?.error?.errorMessage ?? err?.toString() ?? "").toLowerCase();
                    expect(
                        msg.includes("invalid nullifier owner") || msg.includes("invalidnullifierowner"),
                        `Expected InvalidNullifierOwner error, got: ${msg}`,
                    ).to.be.true;
                }
                expect(threw, "Reverifying with a different wallet than the bound owner should be rejected").to.be.true;
            });

            it("updates last_verified_timestamp on success", async () => {
                // create user data with an older last_verified timestamp
                const oldVerified = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago

                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        lastClaimed: new Date(0),
                        lastVerified: oldVerified,
                        verification: { Nullifier: { hash: { [0]: Array.from(worldIdFixture.nullifierHash) } } },
                        proofs: [],
                    }),
                    ...(await buildWorldIdAccountsWithNullifier({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                        nullifierHash: worldIdFixture.nullifierHash,
                        program: baseProgram,
                    })),
                ];

                const { program, solanaWorldIdProgram } = await prepareTest(accounts);

                const before = await fetchUserData(program, user.publicKey);
                const beforeTs = Number(before.lastVerifiedTimestamp);

                await reverify({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        userWallet: user,
                    },
                });

                const after = await fetchUserData(program, user.publicKey);
                const afterTs = Number(after.lastVerifiedTimestamp);

                expect(afterTs).to.be.greaterThan(beforeTs);
            });
        });

        describe("Failure / validation scenarios", () => {
            it.skip("fails with InvalidNullifierHash when provided hash doesn't match user_data", () => {});
            it.skip("fails when any PDA is provided with incorrect seeds (address mismatch)", () => {});
            it.skip("fails when World ID proof is invalid", () => {});
        });

        describe("Accounting", () => {
            it.skip("does not mint or change verified_accounts_count on reverify", () => {});
        });
    });

    describe("UnverifyWithProofRecovery", () => {
        const worldIdFixture = (() => {
            // appId:  "app_6599964a29641e47c6f38c562da0628d"
            // action: "verifyhuman"
            // signal: user wallet address hex + "unverify"
            const proofHex =
                "0x" +
                "0706bc5fd983e475c1b97696c14af6c673d08a7d7196e610c236e7586bb3ce20" +
                "2309be5b8a1ab58356ad91d84438269c658344e48496aeb9f9bb8fc1eef9dd25" +
                "09825d4559052a135bb63490f4cba81940aa81f424026503bf13ca03a12f3b7f" +
                "016d4a2619556e1815d7e120c67fe89785a4e38108809ccb29875639b7884c1f" +
                "2e1e58134da1616604463321414b46a7baf62b3ee8d4166e9fe811d897929420" +
                "18871feaf64aedf9f96f07e2cc425c0859f0cd35fa20a900c222184e5d1581b7" +
                "2759807dd17acc0253b848ade303ef71b39bbfcb9da3ef20743e34ce5df462ee" +
                "2efbaa293dd01233a4101511cfd387ab7cc31e6caac70ef96259ebf827bb8656";

            const rootHex = "0x0eaf6241c8a35811ddad3edab5fc35d9baf5b09391614062aa4d567f51499830";
            const nullifierHex = "0x00fdc9448b89970a2316edc0c161ab169c3b0881263754e420ce6fa030a0b90b";
            // signal_hash: "0x002e81cabbc568106e906de429f6d1640f7fb0a5282ff055cae4e84d34fa3ce1",

            return {
                proof: Buffer.from(proofHex.replace("0x", ""), "hex"),
                rootHash: Buffer.from(rootHex.replace("0x", ""), "hex"),
                nullifierHash: Buffer.from(nullifierHex.replace("0x", ""), "hex"),
            } as const;
        })();

        describe("Core success path scenarios", () => {
            it("verifies proof and clears nullifier_hash from user_data", async () => {
                const worldIdNullifierPda = getWorldIdNullifierPda(worldIdFixture.nullifierHash);

                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        verification: { Nullifier: { hash: { [0]: Array.from(worldIdFixture.nullifierHash) } } },
                        proofs: [],
                    }),
                    await createGlobalDataAddedAccount({ verifiedAccountsCount: 3 }),
                    ...(await buildWorldIdAccountsWithNullifier({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                        nullifierHash: worldIdFixture.nullifierHash,
                        program: baseProgram,
                    })),
                ];

                const { program, solanaWorldIdProgram } = await prepareTest(accounts);

                const before = await fetchGlobalData(program);
                const beforeVerified = before.dailyDistribution.verifiedAccountsCount;

                await unverifyWithProofRecovery({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        user: user.publicKey,
                    },
                });

                const userData = await fetchUserData(program, user.publicKey);
                expect(userData.verification).to.deep.equal({ unverified: {} });

                // verify nullifier account owner was reset to default (unused)
                const conn = program.provider.connection;
                const info = await conn.getAccountInfo(worldIdNullifierPda, "confirmed");
                expect(info).to.not.equal(null);

                const decoded = coder.accounts.decode("Nullifier", info!.data);
                const ownerPk = new PublicKey(decoded.user_wallet);
                expect(ownerPk.toBase58()).to.equal(PublicKey.default.toBase58());

                const after = await fetchGlobalData(program);
                expect(after.dailyDistribution.verifiedAccountsCount).to.equal(beforeVerified - 1);
            });

            it("sets nullifier owner to default (unused) and decrements verified_accounts_count", async () => {
                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        verification: { Nullifier: { hash: { [0]: Array.from(worldIdFixture.nullifierHash) } } },
                        proofs: [],
                    }),
                    await createGlobalDataAddedAccount({ verifiedAccountsCount: 5 }),
                    ...(await buildWorldIdAccountsWithNullifier({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                        nullifierHash: worldIdFixture.nullifierHash,
                        program: baseProgram,
                    })),
                ];

                const { program, solanaWorldIdProgram } = await prepareTest(accounts);

                const before = await fetchGlobalData(program);
                const beforeVerified = before.dailyDistribution.verifiedAccountsCount;

                await unverifyWithProofRecovery({
                    program,
                    solanaWorldIdProgram,
                    rootHash: worldIdFixture.rootHash,
                    nullifierHash: worldIdFixture.nullifierHash,
                    proof: worldIdFixture.proof,
                    accounts: {
                        user: user.publicKey,
                    },
                });

                const after = await fetchGlobalData(program);
                expect(after.dailyDistribution.verifiedAccountsCount).to.equal(beforeVerified - 1);
            });
        });

        describe("Failure / validation scenarios", () => {
            it.skip("fails with InvalidNullifierHash when provided hash doesn't match user_data", () => {});
            it.skip("fails with InvalidNullifierOwner when nullifier has_one doesn't match provided user_wallet", () => {});
            it.skip("fails when World ID proof is invalid", () => {});
            it.skip("fails when any PDA is provided with incorrect seeds (address mismatch)", () => {});
        });

        describe("Edge cases", () => {
            it.skip("does not underflow verified_accounts_count on repeated unverifies", () => {});
        });
    });

    describe("UnverifyWithWalletSignature", () => {
        const worldIdFixture = (() => {
            // appId:  "app_6599964a29641e47c6f38c562da0628d"
            // action: "verifyhuman"
            // signal: user wallet address hex + "unverify"

            // unverifyWithWalletSignature does not require a proof, so we don't need to include it in the fixture.
            // without a proof, the root and nullifier values are unconstrained, but we still use real values.
            //const proofHex =
            //    "0x" +
            //    "0706bc5fd983e475c1b97696c14af6c673d08a7d7196e610c236e7586bb3ce20" +
            //    "2309be5b8a1ab58356ad91d84438269c658344e48496aeb9f9bb8fc1eef9dd25" +
            //    "09825d4559052a135bb63490f4cba81940aa81f424026503bf13ca03a12f3b7f" +
            //    "016d4a2619556e1815d7e120c67fe89785a4e38108809ccb29875639b7884c1f" +
            //    "2e1e58134da1616604463321414b46a7baf62b3ee8d4166e9fe811d897929420" +
            //    "18871feaf64aedf9f96f07e2cc425c0859f0cd35fa20a900c222184e5d1581b7" +
            //    "2759807dd17acc0253b848ade303ef71b39bbfcb9da3ef20743e34ce5df462ee" +
            //    "2efbaa293dd01233a4101511cfd387ab7cc31e6caac70ef96259ebf827bb8656";

            const rootHex = "0x0eaf6241c8a35811ddad3edab5fc35d9baf5b09391614062aa4d567f51499830";
            const nullifierHex = "0x00fdc9448b89970a2316edc0c161ab169c3b0881263754e420ce6fa030a0b90b";
            // signal_hash: "0x002e81cabbc568106e906de429f6d1640f7fb0a5282ff055cae4e84d34fa3ce1",

            return {
                //proof: Buffer.from(proofHex.replace("0x", ""), "hex"),
                rootHash: Buffer.from(rootHex.replace("0x", ""), "hex"),
                nullifierHash: Buffer.from(nullifierHex.replace("0x", ""), "hex"),
            } as const;
        })();

        describe("Core success path scenarios", () => {
            it("clears nullifier_hash without CPI when user_wallet signs and data is current", async () => {
                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        verification: { Nullifier: { hash: { [0]: Array.from(worldIdFixture.nullifierHash) } } },
                        proofs: [],
                    }),
                    await createGlobalDataAddedAccount({ verifiedAccountsCount: 2 }),
                    ...(await buildWorldIdAccountsWithNullifier({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                        nullifierHash: worldIdFixture.nullifierHash,
                        program: baseProgram,
                    })),
                ];

                const { program } = await prepareTest(accounts);

                // call unverifyWithWalletSignature as signer (no CPI to world id program)
                await unverifyWithWalletSignature({
                    program,
                    nullifierHash: worldIdFixture.nullifierHash,
                    accounts: {
                        userWallet: user,
                    },
                });

                const userData = await fetchUserData(program, user.publicKey);
                expect(userData.verification).to.deep.equal({ unverified: {} });
            });

            it("decrements verified_accounts_count and does not reset last_verified_timestamp", async () => {
                const now = new Date();

                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        lastClaimed: new Date(),
                        lastVerified: now,
                        verification: { Nullifier: { hash: { [0]: Array.from(worldIdFixture.nullifierHash) } } },
                        proofs: [],
                    }),
                    await createGlobalDataAddedAccount({ verifiedAccountsCount: 8 }),
                    ...(await buildWorldIdAccountsWithNullifier({
                        userWallet: user.publicKey,
                        rootHash: worldIdFixture.rootHash,
                        nullifierHash: worldIdFixture.nullifierHash,
                        program: baseProgram,
                    })),
                ];

                const { program } = await prepareTest(accounts);

                const before = await fetchGlobalData(program);
                const beforeVerified = before.dailyDistribution.verifiedAccountsCount;

                const beforeUser = await fetchUserData(program, user.publicKey);
                const beforeTs = Number(beforeUser.lastVerifiedTimestamp);
                expect(beforeTs).to.be.greaterThan(0);

                await unverifyWithWalletSignature({
                    program,
                    nullifierHash: worldIdFixture.nullifierHash,
                    accounts: {
                        userWallet: user,
                    },
                });

                const after = await fetchGlobalData(program);
                expect(after.dailyDistribution.verifiedAccountsCount).to.equal(beforeVerified - 1);

                const afterUser = await fetchUserData(program, user.publicKey);
                const afterTs = Number(afterUser.lastVerifiedTimestamp);
                expect(afterTs).to.equal(beforeTs);
            });
        });

        describe("Failure / validation scenarios", () => {
            it.skip("fails with UserDataNotCurrent when user_data is stale", () => {});
            it.skip("fails with InvalidNullifierHash when provided hash doesn't match user_data", () => {});
            it.skip("fails with InvalidNullifierOwner when nullifier has_one doesn't match signer", () => {});
            it.skip("fails when global_data PDA is missing", () => {});
        });

        describe("Accounting", () => {
            it.skip("does not mint or call external programs", () => {});
        });
    });
});

function toHash(b: Uint8Array | Buffer) {
    return { 0: Array.from(b) };
}
