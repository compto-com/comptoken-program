import { addresses, transactions } from "@compto/comptoken.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import type { AddedAccount } from "solana-bankrun";
const { getGlobalDataAddress } = addresses;
const { dailyDistribution } = transactions;

import {
    type ComptokenProgram,
    baseProgram,
    createComptokenLiquidityTokenAccountAddedAccount,
    createGlobalDataAddedAccount,
    createMintAddedAccount,
    createStakedMintAddedAccount,
    createUnstakedMintAddedAccount,
    createUsdcLiquidityTokenAccountAddedAccount,
    createUsdcMintAddedAccount,
    getComptokenLiquidityTokenAccountAddress,
    getUsdcLiquidityTokenAccountAddress,
} from "./utils/accountPreinitHelpers.ts";
import {
    type PoolAddresses,
    addLiquidity,
    createAmmConfigAddedAccount,
    createComptokenUsdcPoolAddedAccounts,
    createObservationStateAddedAccount,
    createPoolStateAddedAccount,
    fetchPoolState,
    getAmmConfigAddress,
    getPoolAddresses,
    sqrt,
    steadyPriceHistory,
    token0SpotPrice,
} from "./utils/raydiumHelpers.ts";
import { normalizeTime, prepareTest, subtractDays } from "./utils/utils.ts";

// 1,000,000.00 COMP against 10,000.000000 USDC, i.e. 1 COMP = $0.01 (100 raw usdc per raw comptoken)
const POOL_COMPTOKEN_RESERVE = 100_000_000n;
const POOL_USDC_RESERVE = 10_000_000_000n;
const MAX_DEVIATION = Number(baseProgram.constants.liquidityMaxPriceDeviationBps) / 10_000;
const TWAP_MIN_WINDOW_SECONDS = Number(baseProgram.constants.liquidityTwapMinWindowSeconds);

async function setup({
    comptokenBalance = 0n,
    usdcBalance = 0n,
    pool: poolOptions = {},
    extraAccounts = [],
}: {
    comptokenBalance?: bigint;
    usdcBalance?: bigint;
    pool?: Partial<Parameters<typeof createComptokenUsdcPoolAddedAccounts>[0]>;
    extraAccounts?: AddedAccount[];
} = {}) {
    const { pool, accounts: poolAccounts } = await createComptokenUsdcPoolAddedAccounts({
        comptokenReserve: POOL_COMPTOKEN_RESERVE,
        usdcReserve: POOL_USDC_RESERVE,
        ...poolOptions,
    });
    const accounts = await Promise.all([
        createGlobalDataAddedAccount(),
        createUnstakedMintAddedAccount({ supply: 1_000_000_000_000n }),
        createUsdcMintAddedAccount(),
        createComptokenLiquidityTokenAccountAddedAccount({ amount: comptokenBalance }),
        createUsdcLiquidityTokenAccountAddedAccount({ amount: usdcBalance }),
    ]);
    const { program } = await prepareTest([...accounts, ...poolAccounts, ...extraAccounts]);
    return { program, pool };
}

function getLpTokenAccountAddress(pool: PoolAddresses): PublicKey {
    return getAssociatedTokenAddressSync(pool.lpMint, getGlobalDataAddress(baseProgram), true, TOKEN_PROGRAM_ID);
}

async function tokenBalance(program: ComptokenProgram, address: PublicKey): Promise<bigint> {
    try {
        const info = await program.provider.connection.getAccountInfo(address);
        // amount is at the same offset for token and token-2022 accounts
        return info!.data.readBigUInt64LE(64);
    } catch {
        // bankrun throws for missing accounts (e.g. the lp token account before add_liquidity first creates it)
        return 0n;
    }
}

async function snapshot(program: ComptokenProgram, pool: PoolAddresses) {
    const poolState = await fetchPoolState(program, pool);
    return {
        comptokenBalance: await tokenBalance(program, getComptokenLiquidityTokenAccountAddress()),
        usdcBalance: await tokenBalance(program, getUsdcLiquidityTokenAccountAddress()),
        poolComptokenVault: await tokenBalance(program, pool.poolComptokenVault),
        poolUsdcVault: await tokenBalance(program, pool.poolUsdcVault),
        lpBalance: await tokenBalance(program, getLpTokenAccountAddress(pool)),
        lpSupply: BigInt(poolState.lp_supply.toString()),
        observationState: (await program.provider.connection.getAccountInfo(pool.observationState))!.data,
    };
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;

/** Mirrors comptoken_swap_amount: x = sqrt(PQ(P + C) / (Q + R)) - P, clamped to [0, C]. */
function expectedSwapAmount(P: bigint, Q: bigint, C: bigint, R: bigint): bigint {
    if (Q + R === 0n) {
        return 0n;
    }
    const x = sqrt((P * Q * (P + C)) / (Q + R)) - P;
    return x < 0n ? 0n : x > C ? C : x;
}

function ceilDiv(a: bigint, b: bigint): bigint {
    return (a + b - 1n) / b;
}

/** Mirrors add_liquidity_pool_share against a fee-free pool, returning the expected state afterwards. */
function expectedAddLiquidity(before: Snapshot) {
    const { poolComptokenVault: P, poolUsdcVault: Q, comptokenBalance: C, usdcBalance: R, lpSupply: L } = before;

    const swapIn = expectedSwapAmount(P, Q, C, R);
    const swapOut = (Q * swapIn) / (P + swapIn);
    const swapped = swapOut > 0n;
    const [comptoken, usdc] = swapped ? [C - swapIn, R + swapOut] : [C, R];
    const [poolComptoken, poolUsdc] = swapped ? [P + swapIn, Q - swapOut] : [P, Q];

    let lp = 0n;
    if (comptoken > 0n && usdc > 0n) {
        const lpFromComptoken = (comptoken * L) / poolComptoken;
        const lpFromUsdc = (usdc * L) / poolUsdc;
        const maxLp = lpFromComptoken < lpFromUsdc ? lpFromComptoken : lpFromUsdc;
        if (maxLp > 1n) {
            lp = maxLp - (maxLp / 1000n + 1n);
        }
    }
    // raydium rounds the amounts required for an lp amount up
    const depositedComptoken = lp > 0n ? ceilDiv(lp * poolComptoken, L) : 0n;
    const depositedUsdc = lp > 0n ? ceilDiv(lp * poolUsdc, L) : 0n;

    return {
        swapped,
        comptokenBalance: comptoken - depositedComptoken,
        usdcBalance: usdc - depositedUsdc,
        poolComptokenVault: poolComptoken + depositedComptoken,
        poolUsdcVault: poolUsdc + depositedUsdc,
        lpMinted: lp,
    };
}

function expectUnchanged(before: Snapshot, after: Snapshot) {
    expect(after.comptokenBalance).to.equal(before.comptokenBalance, "comptoken balance should be unchanged");
    expect(after.usdcBalance).to.equal(before.usdcBalance, "usdc balance should be unchanged");
    expect(after.poolComptokenVault).to.equal(before.poolComptokenVault, "pool comptoken vault should be unchanged");
    expect(after.poolUsdcVault).to.equal(before.poolUsdcVault, "pool usdc vault should be unchanged");
    expect(after.lpBalance).to.equal(before.lpBalance, "no lp tokens should be minted");
    expect(after.lpSupply).to.equal(before.lpSupply, "pool lp supply should be unchanged");
    expect(after.observationState.equals(before.observationState), "no swap should have hit the oracle").to.be.true;
}

async function expectAddLiquidityError(promise: Promise<unknown>, pattern: RegExp, description: string) {
    let threw = false;
    try {
        await promise;
    } catch (err: any) {
        threw = true;
        const msg = err?.error?.errorCode?.code ?? err?.error?.errorMessage ?? String(err?.message ?? err);
        expect(String(msg)).to.match(pattern, `Expected ${description}, got: ${msg}`);
    }
    expect(threw, `Expected add_liquidity to fail with ${description}`).to.be.true;
}

describe("add_liquidity", () => {
    describe("depositing", () => {
        it("swaps part of the comptoken balance for usdc and deposits both into the pool", async () => {
            const { program, pool } = await setup({ comptokenBalance: 1_000_000n });
            const before = await snapshot(program, pool);
            const expected = expectedAddLiquidity(before);
            expect(expected.swapped, "test setup should require a swap").to.be.true;

            await addLiquidity({ program, pool });

            const after = await snapshot(program, pool);
            expect(after.comptokenBalance).to.equal(expected.comptokenBalance);
            expect(after.usdcBalance).to.equal(expected.usdcBalance);
            expect(after.poolComptokenVault).to.equal(expected.poolComptokenVault);
            expect(after.poolUsdcVault).to.equal(expected.poolUsdcVault);
            expect(after.lpBalance).to.equal(expected.lpMinted);
            expect(after.lpSupply).to.equal(before.lpSupply + expected.lpMinted);

            // the swap sizing should leave almost nothing behind on either side (the lp amount is shaved by ~0.1%)
            expect(Number(after.comptokenBalance)).to.be.lessThan(Number(before.comptokenBalance) * 0.005);
            expect(after.lpBalance > 0n, "global_data should hold lp tokens").to.be.true;
            expect(after.observationState.equals(before.observationState), "the swap should update the oracle").to.be
                .false;
        });

        it("accounts for an existing usdc balance when sizing the swap", async () => {
            const { program, pool } = await setup({ comptokenBalance: 1_000_000n, usdcBalance: 25_000_000n });
            const before = await snapshot(program, pool);
            const expected = expectedAddLiquidity(before);
            expect(expected.swapped, "test setup should require a swap").to.be.true;

            await addLiquidity({ program, pool });

            const after = await snapshot(program, pool);
            expect(after.comptokenBalance).to.equal(expected.comptokenBalance);
            expect(after.usdcBalance).to.equal(expected.usdcBalance);
            expect(after.lpBalance).to.equal(expected.lpMinted);
            expect(Number(after.comptokenBalance)).to.be.lessThan(Number(before.comptokenBalance) * 0.005);
            expect(Number(after.usdcBalance)).to.be.lessThan(Number(before.usdcBalance) * 0.005);
        });

        it("deposits without swapping when the held balances already match the pool ratio", async () => {
            const comptokenBalance = 1_000_000n;
            const usdcBalance = (comptokenBalance * POOL_USDC_RESERVE) / POOL_COMPTOKEN_RESERVE;
            const { program, pool } = await setup({ comptokenBalance, usdcBalance });
            const before = await snapshot(program, pool);
            const expected = expectedAddLiquidity(before);
            expect(expected.swapped, "test setup should not require a swap").to.be.false;

            await addLiquidity({ program, pool });

            const after = await snapshot(program, pool);
            expect(after.comptokenBalance).to.equal(expected.comptokenBalance);
            expect(after.usdcBalance).to.equal(expected.usdcBalance);
            expect(after.lpBalance).to.equal(expected.lpMinted);
            expect(after.lpBalance > 0n).to.be.true;
            expect(after.observationState.equals(before.observationState), "no swap should have hit the oracle").to.be
                .true;
        });

        it("does nothing when there is no comptoken to add", async () => {
            const { program, pool } = await setup({ comptokenBalance: 0n, usdcBalance: 5_000_000n });
            const before = await snapshot(program, pool);

            await addLiquidity({ program, pool });

            expectUnchanged(before, await snapshot(program, pool));
        });

        it("can be called again once the lp token account exists", async () => {
            const { program, pool } = await setup({ comptokenBalance: 1_000_000n });

            await addLiquidity({ program, pool });
            const afterFirst = await snapshot(program, pool);
            expect(afterFirst.lpBalance > 0n).to.be.true;

            await addLiquidity({ program, pool });
            const afterSecond = await snapshot(program, pool);
            expect(afterSecond.lpBalance >= afterFirst.lpBalance, "lp balance should not decrease").to.be.true;
            expect(afterSecond.comptokenBalance <= afterFirst.comptokenBalance).to.be.true;
        });

        it("deposits the comptoken minted by daily_distribution", async () => {
            const { pool, accounts: poolAccounts } = await createComptokenUsdcPoolAddedAccounts({
                comptokenReserve: POOL_COMPTOKEN_RESERVE,
                usdcReserve: POOL_USDC_RESERVE,
            });
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: 5_500,
                    highWaterMark: 4_000,
                    lastUpdate: normalizeTime(subtractDays(new Date(), 1)),
                }),
                createStakedMintAddedAccount({ supply: 40_000 }),
                createUnstakedMintAddedAccount({ supply: 20_000 }),
                createUsdcMintAddedAccount(),
                createComptokenLiquidityTokenAccountAddedAccount(),
                createUsdcLiquidityTokenAccountAddedAccount(),
            ]);
            const { program } = await prepareTest([...accounts, ...poolAccounts]);

            await dailyDistribution({ program });
            const before = await snapshot(program, pool);
            expect(before.comptokenBalance > 0n, "daily_distribution should mint the liquidity pool's share").to.be
                .true;
            const expected = expectedAddLiquidity(before);

            await addLiquidity({ program, pool });

            const after = await snapshot(program, pool);
            expect(after.comptokenBalance).to.equal(expected.comptokenBalance);
            expect(after.lpBalance).to.equal(expected.lpMinted);
            expect(after.lpBalance > 0n).to.be.true;
        });
    });

    describe("sandwich protection", () => {
        const spot = token0SpotPrice(POOL_COMPTOKEN_RESERVE, POOL_USDC_RESERVE);

        it("defers when the oracle has less history than the TWAP window", async () => {
            const { program, pool } = await setup({
                comptokenBalance: 1_000_000n,
                pool: {
                    observations: steadyPriceHistory({
                        token0Price: spot,
                        historySeconds: TWAP_MIN_WINDOW_SECONDS - 60,
                    }),
                },
            });
            const before = await snapshot(program, pool);

            await addLiquidity({ program, pool });

            expectUnchanged(before, await snapshot(program, pool));
        });

        it("defers when the spot price is above the TWAP by more than the allowed deviation", async () => {
            const { program, pool } = await setup({
                comptokenBalance: 1_000_000n,
                pool: { observations: steadyPriceHistory({ token0Price: spot / (1 + 2 * MAX_DEVIATION) }) },
            });
            const before = await snapshot(program, pool);

            await addLiquidity({ program, pool });

            expectUnchanged(before, await snapshot(program, pool));
        });

        it("defers when the spot price is below the TWAP by more than the allowed deviation", async () => {
            const { program, pool } = await setup({
                comptokenBalance: 1_000_000n,
                pool: { observations: steadyPriceHistory({ token0Price: spot * (1 + 2 * MAX_DEVIATION) }) },
            });
            const before = await snapshot(program, pool);

            await addLiquidity({ program, pool });

            expectUnchanged(before, await snapshot(program, pool));
        });

        it("proceeds when the spot price is within the allowed deviation of the TWAP", async () => {
            const { program, pool } = await setup({
                comptokenBalance: 1_000_000n,
                pool: { observations: steadyPriceHistory({ token0Price: spot * (1 + MAX_DEVIATION / 2) }) },
            });
            const before = await snapshot(program, pool);
            const expected = expectedAddLiquidity(before);

            await addLiquidity({ program, pool });

            const after = await snapshot(program, pool);
            expect(after.lpBalance).to.equal(expected.lpMinted);
            expect(after.lpBalance > 0n).to.be.true;
        });
    });

    describe("validation", () => {
        for (const fee of ["tradeFeeRate", "protocolFeeRate", "fundFeeRate", "creatorFeeRate"] as const) {
            it(`fails when the amm config has a non-zero ${fee}`, async () => {
                const { program, pool } = await setup({
                    comptokenBalance: 1_000_000n,
                    pool: { ammConfig: { [fee]: 2_500 } },
                });

                await expectAddLiquidityError(
                    addLiquidity({ program, pool }),
                    /LiquidityPoolFeeNotZero|non-zero fee/i,
                    "LiquidityPoolFeeNotZero",
                );
            });
        }

        it("fails when the pool's comptoken vault is empty", async () => {
            const { program, pool } = await setup({
                comptokenBalance: 1_000_000n,
                pool: {
                    comptokenReserve: 0n,
                    lpSupply: 1_000n,
                    observations: steadyPriceHistory({ token0Price: 1 }),
                },
            });

            await expectAddLiquidityError(
                addLiquidity({ program, pool }),
                /LiquidityPoolEmpty|pool is empty/i,
                "LiquidityPoolEmpty",
            );
        });

        it("fails when the lp mint is not the pool's", async () => {
            const wrongLpMint = Keypair.generate().publicKey;
            const { program, pool } = await setup({
                comptokenBalance: 1_000_000n,
                extraAccounts: [
                    createMintAddedAccount({
                        address: wrongLpMint,
                        mintAuthority: Keypair.generate().publicKey,
                        decimals: 9,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    }),
                ],
            });

            await expectAddLiquidityError(
                addLiquidity({ program, pool, accounts: { lpMint: wrongLpMint } }),
                /ConstraintAddress|address constraint/i,
                "ConstraintAddress",
            );
        });

        it("fails when the observation state is not the pool's", async () => {
            const otherPool = getPoolAddresses(Keypair.generate().publicKey);
            const { program, pool } = await setup({
                comptokenBalance: 1_000_000n,
                extraAccounts: [
                    createObservationStateAddedAccount({
                        pool: otherPool,
                        samples: steadyPriceHistory({
                            token0Price: token0SpotPrice(POOL_COMPTOKEN_RESERVE, POOL_USDC_RESERVE),
                        }),
                    }),
                ],
            });

            await expectAddLiquidityError(
                addLiquidity({ program, pool, accounts: { observationState: otherPool.observationState } }),
                /ConstraintAddress|address constraint/i,
                "ConstraintAddress",
            );
        });

        it("fails when the amm config is not the pool's", async () => {
            const otherAmmConfig = getAmmConfigAddress(1);
            const { program, pool } = await setup({
                comptokenBalance: 1_000_000n,
                extraAccounts: [await createAmmConfigAddedAccount({ address: otherAmmConfig })],
            });

            await expectAddLiquidityError(
                addLiquidity({ program, pool, accounts: { ammConfig: otherAmmConfig } }),
                /ConstraintAddress|address constraint/i,
                "ConstraintAddress",
            );
        });

        it("fails when the vaults are not the pool's", async () => {
            const otherPool = getPoolAddresses(Keypair.generate().publicKey);
            const { pool, accounts: poolAccounts } = await createComptokenUsdcPoolAddedAccounts({
                comptokenReserve: POOL_COMPTOKEN_RESERVE,
                usdcReserve: POOL_USDC_RESERVE,
            });
            // a second set of vaults with the right mints, at addresses the pool state doesn't reference
            const otherVaults = poolAccounts
                .filter((a) => a.address.equals(pool.poolComptokenVault) || a.address.equals(pool.poolUsdcVault))
                .map((a) => ({
                    ...a,
                    address: a.address.equals(pool.poolComptokenVault)
                        ? otherPool.poolComptokenVault
                        : otherPool.poolUsdcVault,
                }));
            const { program } = await setup({ comptokenBalance: 1_000_000n, extraAccounts: otherVaults });

            await expectAddLiquidityError(
                addLiquidity({ program, pool, accounts: { poolComptokenVault: otherPool.poolComptokenVault } }),
                /ConstraintAddress|address constraint/i,
                "ConstraintAddress",
            );
            await expectAddLiquidityError(
                addLiquidity({ program, pool, accounts: { poolUsdcVault: otherPool.poolUsdcVault } }),
                /ConstraintAddress|address constraint/i,
                "ConstraintAddress",
            );
        });

        it("fails when the vaults are swapped", async () => {
            const { program, pool } = await setup({ comptokenBalance: 1_000_000n });

            await expectAddLiquidityError(
                addLiquidity({
                    program,
                    pool,
                    accounts: { poolComptokenVault: pool.poolUsdcVault, poolUsdcVault: pool.poolComptokenVault },
                }),
                /ConstraintTokenMint|token mint constraint/i,
                "ConstraintTokenMint",
            );
        });

        it("fails when the pool state is not the COMP/USDC pool", async () => {
            const otherPool = { ...getPoolAddresses(), poolState: Keypair.generate().publicKey };
            const { program, pool } = await setup({
                comptokenBalance: 1_000_000n,
                extraAccounts: [await createPoolStateAddedAccount({ pool: otherPool, lpSupply: 1_000_000_000n })],
            });

            await expectAddLiquidityError(
                (program as any).methods
                    .addLiquidity()
                    .accountsPartial({
                        poolState: otherPool.poolState,
                        lpMint: pool.lpMint,
                        poolComptokenVault: pool.poolComptokenVault,
                        poolUsdcVault: pool.poolUsdcVault,
                        ammConfig: pool.ammConfig,
                        observationState: pool.observationState,
                    })
                    .rpc(),
                /ConstraintAddress|address constraint/i,
                "ConstraintAddress",
            );
        });

        it("fails when the usdc liquidity token account does not exist", async () => {
            const { pool, accounts: poolAccounts } = await createComptokenUsdcPoolAddedAccounts({
                comptokenReserve: POOL_COMPTOKEN_RESERVE,
                usdcReserve: POOL_USDC_RESERVE,
            });
            const accounts = await Promise.all([
                createGlobalDataAddedAccount(),
                createUnstakedMintAddedAccount(),
                createUsdcMintAddedAccount(),
                createComptokenLiquidityTokenAccountAddedAccount({ amount: 1_000_000n }),
            ]);
            const { program } = await prepareTest([...accounts, ...poolAccounts]);

            await expectAddLiquidityError(
                addLiquidity({ program, pool }),
                /AccountNotInitialized|usdc_liquidity_token_account/i,
                "AccountNotInitialized",
            );
        });
    });
});
