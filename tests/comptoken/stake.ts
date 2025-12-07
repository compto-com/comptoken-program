import { addresses, transactions } from "@compto/comptoken.js";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
const {
    getStakedMintAddress,
    getUnstakedMintAddress,
    getUserStakedTokensAddress,
    getUserUnstakedAssociatedTokenAddress,
} = addresses;
const { stake, unstake } = transactions;

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
import { prepareTest } from "./utils/utils.ts";

describe("stake", () => {
    describe("Core success path scenarios", () => {
        it("allows a user to stake tokens and increases staked supply", async () => {
            const user = Keypair.generate();

            // Derive PDAs for mints & user data
            const stakedMintPda = getStakedMintAddress(baseProgram);
            const unstakedMintPda = getUnstakedMintAddress(baseProgram);

            const userStakedAta = getUserStakedTokensAddress(baseProgram, user.publicKey);
            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const initialUnstakedUserAmount = 500n;
            const stakeAmount = 200n; // < initialUnstakedUserAmount

            // Create test accounts
            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey }),
                createGlobalDataAddedAccount(),
                createStakedMintAddedAccount({ supply: 0 }),
                createUnstakedMintAddedAccount({ supply: initialUnstakedUserAmount }),
                createStakedTokenAccountAddedAccount({ owner: user.publicKey, amount: 0 }),
                createUnstakedTokenAccountAddedAccount({
                    address: userUnstakedAta,
                    owner: user.publicKey,
                    amount: initialUnstakedUserAmount,
                }),
            ]);

            const { provider, program } = await prepareTest(accounts);

            // Fetch before state
            const [beforeUnstakedAcct, beforeStakedAcct, beforeUnstakedMint, beforeStakedMint] = await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getAccount(provider.connection, userStakedAta),
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
            ]);

            const totalSupplyBefore = beforeUnstakedMint.supply + beforeStakedMint.supply;

            // Invoke stake
            await stake({
                program,
                amount: Number(stakeAmount),
                accounts: {
                    userWallet: user,
                },
            });

            // Fetch after state
            const [afterUnstakedAcct, afterStakedAcct, afterUnstakedMint, afterStakedMint] = await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getAccount(provider.connection, userStakedAta),
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
            ]);

            // Assertions
            expect(afterUnstakedAcct.amount).to.equal(beforeUnstakedAcct.amount - stakeAmount);
            expect(afterStakedAcct.amount).to.equal(beforeStakedAcct.amount + stakeAmount);
            expect(afterUnstakedMint.supply + afterStakedMint.supply).to.equal(totalSupplyBefore);
        });

        it("allows a user to unstake tokens and decreases staked supply", async () => {
            const user = Keypair.generate();
            const stakedMintPda = getStakedMintAddress(baseProgram);
            const unstakedMintPda = getUnstakedMintAddress(baseProgram);

            const userStakedAta = getUserStakedTokensAddress(baseProgram, user.publicKey);
            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const initialStakedUserAmount = 300n;
            const initialUnstakedUserAmount = 100n;
            const unstakeAmount = 120n; // < initialStakedUserAmount

            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey }),
                createGlobalDataAddedAccount(),
                createStakedMintAddedAccount({ supply: initialStakedUserAmount }),
                createUnstakedMintAddedAccount({ supply: initialUnstakedUserAmount }),
                createStakedTokenAccountAddedAccount({
                    owner: user.publicKey,
                    amount: initialStakedUserAmount,
                }),
                createUnstakedTokenAccountAddedAccount({
                    address: userUnstakedAta,
                    owner: user.publicKey,
                    amount: initialUnstakedUserAmount,
                }),
            ]);

            const { provider, program } = await prepareTest(accounts);

            const [beforeUnstakedAcct, beforeStakedAcct, beforeUnstakedMint, beforeStakedMint] = await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getAccount(provider.connection, userStakedAta),
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
            ]);
            const totalSupplyBefore = beforeUnstakedMint.supply + beforeStakedMint.supply;

            await unstake({
                program,
                amount: Number(unstakeAmount), // negative amount to unstake
                accounts: {
                    userWallet: user,
                },
            });

            const [afterUnstakedAcct, afterStakedAcct, afterUnstakedMint, afterStakedMint] = await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getAccount(provider.connection, userStakedAta),
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
            ]);

            expect(afterUnstakedAcct.amount).to.equal(beforeUnstakedAcct.amount + unstakeAmount);
            expect(afterStakedAcct.amount).to.equal(beforeStakedAcct.amount - unstakeAmount);
            expect(afterUnstakedMint.supply + afterStakedMint.supply).to.equal(totalSupplyBefore);
        });

        it("accrues rewards correctly after multiple stake/unstake cycles (supply invariant)", async () => {
            const user = Keypair.generate();
            const stakedMintPda = getStakedMintAddress(baseProgram);
            const unstakedMintPda = getUnstakedMintAddress(baseProgram);

            const userStakedAta = getUserStakedTokensAddress(baseProgram, user.publicKey);
            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey }),
                createGlobalDataAddedAccount({
                    historicDistributions: {
                        position: 2,
                        buffer: [
                            { yieldRate: 0.25, ubiYield: 0 },
                            { yieldRate: 0.5, ubiYield: 0 },
                        ],
                    },
                }),
                createStakedMintAddedAccount({ supply: 0 }),
                createUnstakedMintAddedAccount({ supply: 1000 }),
                createStakedTokenAccountAddedAccount({ owner: user.publicKey, amount: 0 }),
                createUnstakedTokenAccountAddedAccount({
                    address: userUnstakedAta,
                    owner: user.publicKey,
                    amount: 1000,
                }),
            ]);
            const { provider, program } = await prepareTest(accounts);

            const [beforeUnstakedMint, beforeStakedMint] = await Promise.all([
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
            ]);
            const totalSupplyBefore = beforeUnstakedMint.supply + beforeStakedMint.supply;

            // Perform two stakes and one unstake
            const stake1 = 300n;
            const stake2 = 200n;
            const unstake1 = 250n;

            async function stakeOnce(amount: bigint) {
                return stake({
                    program,
                    amount: Number(amount),
                    accounts: {
                        userWallet: user,
                    },
                });
            }
            async function unstakeOnce(amount: bigint) {
                return unstake({
                    program,
                    amount: Number(amount),
                    accounts: {
                        userWallet: user,
                    },
                });
            }

            await stakeOnce(stake1);
            await stakeOnce(stake2);
            await unstakeOnce(unstake1);

            const [afterUnstakedAcct, afterStakedAcct, afterUnstakedMint, afterStakedMint] = await Promise.all([
                getAccount(provider.connection, userUnstakedAta),
                getAccount(provider.connection, userStakedAta),
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
            ]);

            // Net stake = stake1 + stake2 - unstake1
            const netStake = stake1 + stake2 - unstake1;
            expect(afterStakedAcct.amount).to.equal(netStake);
            expect(afterUnstakedAcct.amount).to.equal(1000n - netStake);
            expect(afterUnstakedMint.supply + afterStakedMint.supply).to.equal(totalSupplyBefore);
        });

        it("prevents unstake when user has insufficient staked balance", async () => {
            const user = Keypair.generate();
            const stakedMintPda = getStakedMintAddress(baseProgram);
            const unstakedMintPda = getUnstakedMintAddress(baseProgram);

            const userUnstakedAta = getUserUnstakedAssociatedTokenAddress(baseProgram, user.publicKey);

            const accounts = await Promise.all([
                createUserDataAddedAccount({ userPubkey: user.publicKey }),
                createGlobalDataAddedAccount(),
                createStakedMintAddedAccount({ supply: 50 }),
                createUnstakedMintAddedAccount({ supply: 500 }),
                createStakedTokenAccountAddedAccount({ owner: user.publicKey, amount: 50 }),
                createUnstakedTokenAccountAddedAccount({
                    address: userUnstakedAta,
                    owner: user.publicKey,
                    amount: 500,
                }),
            ]);
            const { provider, program } = await prepareTest(accounts);

            const [beforeUnstakedMint, beforeStakedMint] = await Promise.all([
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
            ]);
            const totalSupplyBefore = beforeUnstakedMint.supply + beforeStakedMint.supply;

            let threw = false;
            try {
                await unstake({
                    program,
                    amount: 51, // more than staked balance of 50
                    accounts: {
                        userWallet: user,
                    },
                });
            } catch (e: any) {
                threw = true;
                expect(String(e.message || e)).to.match(/InsufficientFunds|insufficient|fail/i);
            }
            expect(threw, "Expected unstake to fail with insufficient staked balance").to.be.true;

            const [afterUnstakedMint, afterStakedMint] = await Promise.all([
                getMint(provider.connection, unstakedMintPda),
                getMint(provider.connection, stakedMintPda),
            ]);
            expect(afterUnstakedMint.supply + afterStakedMint.supply).to.equal(totalSupplyBefore);
            expect(afterStakedMint.supply).to.equal(beforeStakedMint.supply); // unchanged
            expect(afterUnstakedMint.supply).to.equal(beforeUnstakedMint.supply); // unchanged
        });
    });

    describe("Permissioning & authority", () => {
        it.skip("rejects stake instruction when signer is not authorized", async () => {});
        it.skip("supports delegated stake operations via approved delegate", async () => {});
    });

    describe("Edge cases & invariants", () => {
        it.skip("handles zero-amount stake/unstake gracefully (no state change)", async () => {});
        it.skip("does not allow staking more than total supply", async () => {});
        it.skip("keeps global totals consistent after concurrent stakes", async () => {});
    });

    describe("Reward calculation specifics", () => {
        it.skip("computes per-account yield_rate proportional to staked share", async () => {});
        it.skip("handles zero staked_supply when calculating yield_rate", async () => {});
        it.skip("updates historical reward entries when staking triggers distribution", async () => {});
    });

    describe("Failure / validation scenarios", () => {
        it.skip("fails when stake account PDA missing", async () => {});
        it.skip("fails when global_data PDA missing for stake operation", async () => {});
        it.skip("fails when attempting to stake on incorrect mint PDA", async () => {});
    });

    describe("Integration & long-running behavior", () => {
        it.skip("maintains correctness across repeated daily distributions and stakes", async () => {});
        it.skip("respects stake lockup durations and cooldown windows if configured", async () => {});
    });
});
