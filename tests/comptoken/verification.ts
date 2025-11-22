import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

import {
    baseProgram,
    buildWorldIdAccountsForVerify,
    createGlobalDataAddedAccount,
    createUnstakedMintAddedAccount,
    createUnstakedTokenAccountAddedAccount,
    createUserDataAddedAccount,
    getAccount,
    getMint,
    getWorldIdConfigPdaAndBump,
    getWorldIdLatestRootPdaAndBump,
    getWorldIdNullifierPda,
    getWorldIdRootPdaAndBump,
    solanaWorldIdProgram,
} from "./utils/accountPreinitHelpers.ts";
import { fetchGlobalData, fetchUserData, getGlobalDataPda, getUserDataPda } from "./utils/stateHelpers.ts";
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
                const [worldIdLatestRoot] = getWorldIdLatestRootPdaAndBump();
                const [worldIdRoot] = getWorldIdRootPdaAndBump(worldIdFixture.rootHash);

                // Seed on-chain state required for verify
                const accounts = [
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

                const { provider, program } = await prepareTest(accounts);

                // Call verify
                await program.methods
                    .verify({
                        rootHash: toHash(worldIdFixture.rootHash),
                        nullifierHash: toHash(worldIdFixture.nullifierHash),
                        proof: Array.from(worldIdFixture.proof),
                    })
                    .accountsPartial({
                        payer: provider.wallet.publicKey,
                        userWallet: user.publicKey,
                        userUnstakedTokenAccount: userUnstakedAta,
                        worldIdLatestRoot: worldIdLatestRoot,
                        worldIdRoot: worldIdRoot,
                        worldIdNullifier: getWorldIdNullifierPda(worldIdFixture.nullifierHash),
                    })
                    .signers([user])
                    .rpc();

                const userData = await fetchUserData(program, user.publicKey);
                expect(Uint8Array.from(userData.nullifierHash[0])).to.deep.equal(
                    Uint8Array.from(worldIdFixture.nullifierHash),
                );
            });

            it("mints per-capita early adopter UBI to user's unstaked token account when remaining_early_adopter_count > 0", async () => {
                const perCapita = 12345; // arbitrary test value

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
                const [worldIdLatestRoot] = getWorldIdLatestRootPdaAndBump();
                const worldIdNullifier = getWorldIdNullifierPda(worldIdFixture.nullifierHash);
                const [worldIdRoot] = getWorldIdRootPdaAndBump(worldIdFixture.rootHash);

                const accounts = [
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

                const { provider, program } = await prepareTest(accounts);

                const [beforeUserUnstaked, beforeMint] = await Promise.all([
                    getAccount(provider.connection, userUnstakedAta),
                    getMint(provider.connection, unstakedMintPda),
                ]);

                await program.methods
                    .verify({
                        rootHash: toHash(worldIdFixture.rootHash),
                        nullifierHash: toHash(worldIdFixture.nullifierHash),
                        proof: Array.from(worldIdFixture.proof),
                    })
                    .accountsPartial({
                        payer: provider.wallet.publicKey,
                        userWallet: user.publicKey,
                        userUnstakedTokenAccount: userUnstakedAta,
                        worldIdRoot,
                        worldIdLatestRoot,
                        worldIdNullifier,
                    })
                    .signers([user])
                    .rpc();

                const [afterUserUnstaked, afterMint] = await Promise.all([
                    getAccount(provider.connection, userUnstakedAta),
                    getMint(provider.connection, unstakedMintPda),
                ]);

                expect(Number(afterUserUnstaked.amount - beforeUserUnstaked.amount)).to.equal(perCapita);
                expect(Number(afterMint.supply - beforeMint.supply)).to.equal(perCapita);
            });

            it("increments verified_accounts_count and decrements remaining_early_adopter_count on success", async () => {
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
                const [worldIdConfigPda] = getWorldIdConfigPdaAndBump();
                const [worldIdLatestRoot] = getWorldIdLatestRootPdaAndBump();
                const worldIdNullifier = getWorldIdNullifierPda(worldIdFixture.nullifierHash);
                const [worldIdRoot] = getWorldIdRootPdaAndBump(worldIdFixture.rootHash);

                const accounts = [
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

                const { provider, program } = await prepareTest(accounts);

                const before = await fetchGlobalData(program);
                const initialVerified = before.dailyDistribution.verifiedAccountsCount;
                const initialRemaining = before.dailyDistribution.remainingEarlyAdopterCount;

                await program.methods
                    .verify({
                        rootHash: toHash(worldIdFixture.rootHash),
                        nullifierHash: toHash(worldIdFixture.nullifierHash),
                        proof: Array.from(worldIdFixture.proof),
                    })
                    .accountsPartial({
                        payer: provider.wallet.publicKey,
                        userWallet: user.publicKey,
                        userUnstakedTokenAccount: userUnstakedAta,
                        worldIdRoot,
                        worldIdLatestRoot,
                        worldIdNullifier,
                    })
                    .signers([user])
                    .rpc();

                const after = await fetchGlobalData(program);
                expect(after.dailyDistribution.verifiedAccountsCount).to.equal(initialVerified + 1);
                expect(after.dailyDistribution.remainingEarlyAdopterCount).to.equal(initialRemaining - 1);
            });
        });

        describe("Failure / validation scenarios", () => {
            it.skip("fails with UserDataNotCurrent when user_data is stale", () => {});
            it.skip("fails with NullifierAlreadyUsed when nullifier was used by a different wallet", () => {});
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
            it.skip("re-verifies under the same nullifier without requiring user_data to be current", () => {});
            it.skip("updates last_verified_timestamp on success", () => {});
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
            it.skip("verifies proof and clears nullifier_hash from user_data", () => {});
            it.skip("sets nullifier owner to default (unused) and decrements verified_accounts_count", () => {});
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
            it.skip("clears nullifier_hash without CPI when user_wallet signs and data is current", () => {});
            it.skip("decrements verified_accounts_count and resets last_verified_timestamp to 0", () => {});
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
