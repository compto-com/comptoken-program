import {
    getUnstakedMintAddress,
    getUserUnstakedAssociatedTokenAddress,
    reverify,
    unverify,
    unverify2,
    verify,
} from "@compto/comptoken.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

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
    const worldIdFixture = (() => {
        // appId:  "self_hosted"
        // action: "COMPTO-VerifyHuman"
        // signal: user wallet address hex
        const proofHex =
            "2b51a7d604a61ac24b6a1999b71e1990d20c6d7f1c66067ff510c42814535301" +
            "1173e5129b2570d156384a05640161f59ca720a32fdbd52c06215823f12ca93e" +
            "14eeb39f03c8da6f0d169e13b944b14b4b24185d5d12c4b200bc9c13f4893f89" +
            "2359405b9a367182927ad6c0aebd475dbc86176c584ae89e003abab45199842c" +
            "14714401354f3c1b05c95997dfe9d2813cfea3c889db138be0b2d4f90053a60e" +
            "244b97d17c7bb6953790b1a23a9755cff48c8f8449bd74960d44a119282b1f6f" +
            "176825121ef2377c41ad9b56acf56c61dfde353e658aa08254aa0f3ae367f6c7" +
            "069cb422d80e4e586f1961552b2b6c0694569c1f815e6b907a03549698c6382a";

        const rootHex = "28836d5b43240ca2763eb0997dcd346b6e3225bfc32fb881e880b5bd116a117c";
        const nullifierHex = "06e05b30363654d2be77b7b16091735f139f31bc097bb2a1aa9450b96f7df677";

        return {
            proof: Buffer.from(proofHex, "hex"),
            rootHash: Buffer.from(rootHex, "hex"),
            nullifierHash: Buffer.from(nullifierHex, "hex"),
        } as const;
    })();

    const user = Keypair.fromSeed(new Uint8Array(32).fill(0x01));

    describe("Verify (World ID)", () => {
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
                expect(Uint8Array.from(userData.nullifierHash[0])).to.deep.equal(
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
        describe("Core success path scenarios", () => {
            it("re-verifies under the same nullifier without requiring user_data to be current", async () => {
                // Seed on-chain state: user_data is stale (last_claimed not equal to today) but has nullifier set
                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        // make last_claimed old so `is_current()` is false
                        lastClaimed: new Date(0),
                        lastVerified: new Date(0),
                        nullifierHash: worldIdFixture.nullifierHash,
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
                expect(Uint8Array.from(userData.nullifierHash[0])).to.deep.equal(
                    Uint8Array.from(worldIdFixture.nullifierHash),
                );
            });

            it("updates last_verified_timestamp on success", async () => {
                // create user data with an older last_verified timestamp
                const oldVerified = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago

                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        lastClaimed: new Date(0),
                        lastVerified: oldVerified,
                        nullifierHash: worldIdFixture.nullifierHash,
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

    describe("Unverify (World ID)", () => {
        describe("Core success path scenarios", () => {
            it("verifies proof and clears nullifier_hash from user_data", async () => {
                const worldIdNullifierPda = getWorldIdNullifierPda(worldIdFixture.nullifierHash);

                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        nullifierHash: worldIdFixture.nullifierHash,
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

                await unverify({
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
                expect(Uint8Array.from(userData.nullifierHash[0])).to.deep.equal(
                    Uint8Array.from(new Uint8Array(32).fill(0)),
                );

                // verify nullifier account owner was reset to default (unused)
                const conn = program.provider.connection;
                const info = await conn.getAccountInfo(worldIdNullifierPda, "confirmed");
                expect(info).to.not.equal(null);

                const decoded = coder.accounts.decode("Nullifier", info.data);
                const ownerPk = new PublicKey(decoded.user_wallet);
                expect(ownerPk.toBase58()).to.equal(PublicKey.default.toBase58());

                const after = await fetchGlobalData(program);
                expect(after.dailyDistribution.verifiedAccountsCount).to.equal(beforeVerified - 1);
            });

            it("sets nullifier owner to default (unused) and decrements verified_accounts_count", async () => {
                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        nullifierHash: worldIdFixture.nullifierHash,
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

                await unverify({
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

    describe("Unverify2 (no proof)", () => {
        describe("Core success path scenarios", () => {
            it("clears nullifier_hash without CPI when user_wallet signs and data is current", async () => {
                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        nullifierHash: worldIdFixture.nullifierHash,
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

                // call unverify2 as signer (no CPI to world id program)
                await unverify2({
                    program,
                    nullifierHash: worldIdFixture.nullifierHash,
                    accounts: {
                        userWallet: user,
                    },
                });

                const userData = await fetchUserData(program, user.publicKey);
                expect(Uint8Array.from(userData.nullifierHash[0])).to.deep.equal(
                    Uint8Array.from(new Uint8Array(32).fill(0)),
                );
            });

            it("decrements verified_accounts_count and resets last_verified_timestamp to 0", async () => {
                const now = new Date();

                const accounts = [
                    await createUserDataAddedAccount({
                        userPubkey: user.publicKey,
                        lastClaimed: new Date(),
                        lastVerified: now,
                        nullifierHash: worldIdFixture.nullifierHash,
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

                await unverify2({
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
                expect(afterTs).to.equal(0);
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
