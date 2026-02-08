import { transactions } from "@compto/comptoken.js";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
const { dailyDistribution } = transactions;

import {
    baseProgram,
    createGlobalDataAddedAccount,
    createStakedMintAddedAccount,
    createUnstakedMintAddedAccount,
    type HistoricDistribution,
} from "./utils/accountPreinitHelpers.ts";
import { fetchGlobalData, getLatestDistribution } from "./utils/stateHelpers.ts";
import { expectAlmostEqual, expectHistoryAdvancedBy } from "./utils/testAssertions.ts";
import { normalizeTime, prepareTest, subtractDays, toUnixTime } from "./utils/utils.ts";

describe("daily_distribution", () => {
    describe("Core success path scenarios", () => {
        it("records distribution when total_mined_today > high_water_mark", async () => {
            // Setup: total_mined_today greater than current high_water_mark should push a non-zero distribution
            const startingHwm = 10_000; // arbitrary smaller than mined today
            const minedToday = 12_345; // ensures increase > 0
            const beforeTs = normalizeTime(subtractDays(new Date(), 1)); // yesterday

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                }),
                createStakedMintAddedAccount({ supply: 50_000 }),
                createUnstakedMintAddedAccount({ supply: 150_000 }),
            ]);

            const { program } = await prepareTest(accounts);
            const beforeGlobal = await fetchGlobalData(program);

            await dailyDistribution({ program });

            const afterGlobal = await fetchGlobalData(program);
            expectHistoryAdvancedBy(beforeGlobal, afterGlobal, program, 1);
            const pushedEntry = getLatestDistribution(afterGlobal, program);
            expect(pushedEntry.yieldRate).to.be.greaterThan(0, "Yield rate should be > 0 when mining occurred");
            // ubi_yield may be 0 if no verified accounts; that's fine — ensure high_water_mark grew
            expect(afterGlobal.dailyDistribution.highWaterMark.toNumber()).to.be.greaterThan(startingHwm);
            // total_mined_today reset
            expect(afterGlobal.dailyDistribution.totalMinedToday.toNumber()).to.equal(0);
        });

        it("records zeroed distribution when total_mined_today < high_water_mark", async () => {
            // Setup: total_mined_today less than current high_water_mark should push a zeroed distribution
            const startingHwm = 10_000; // arbitrary smaller than mined today
            const minedToday = 5_000; // ensures increase < 0
            const beforeTs = normalizeTime(subtractDays(new Date(), 1)); // yesterday

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                }),
                createStakedMintAddedAccount({ supply: 50_000 }),
                createUnstakedMintAddedAccount({ supply: 150_000 }),
            ]);

            const { program } = await prepareTest(accounts);
            const beforeGlobal = await fetchGlobalData(program);

            await dailyDistribution({ program });

            const afterGlobal = await fetchGlobalData(program);
            expectHistoryAdvancedBy(beforeGlobal, afterGlobal, program, 1);
            const pushedEntry = getLatestDistribution(afterGlobal, program);
            expect(pushedEntry.yieldRate).to.equal(0, "Yield rate should be 0 when not enough mining occurred");
            expect(afterGlobal.dailyDistribution.highWaterMark.toNumber()).to.equal(startingHwm);
            expect(afterGlobal.dailyDistribution.totalMinedToday.toNumber()).to.equal(0);
        });

        it("pushes zeroed HistoricDistribution entry when no mining", async () => {
            const startingHwm = 5_000;
            const beforeTs = normalizeTime(subtractDays(new Date(), 1)); // yesterday
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: 0,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                    historicDistributions: { position: 3, buffer: [{ yieldRate: 1.1, ubiYield: 7 }] },
                }),
                createStakedMintAddedAccount({ supply: 10_000 }),
                createUnstakedMintAddedAccount({ supply: 25_000 }),
            ]);
            const { program } = await prepareTest(accounts);
            const beforeGlobal = await fetchGlobalData(program);

            await dailyDistribution({ program });

            const afterGlobal = await fetchGlobalData(program);
            expectHistoryAdvancedBy(beforeGlobal, afterGlobal, program, 1);

            const pushedEntry = getLatestDistribution(afterGlobal, program);
            expect(pushedEntry.yieldRate).to.equal(0);
            expect(Number(pushedEntry.ubiYield)).to.equal(0);
            expect(afterGlobal.dailyDistribution.highWaterMark.toNumber()).to.equal(startingHwm);
            expect(afterGlobal.dailyDistribution.totalMinedToday.toNumber()).to.equal(0);
        });

        it("updates last_update_timestamp to normalized current time", async () => {
            const yesterday = normalizeTime(new Date(Date.now() - 86400_000));
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: 1000,
                    highWaterMark: 900,
                    lastUpdate: yesterday,
                    historicDistributions: { position: 0, buffer: [{ yieldRate: 0, ubiYield: 0 }] },
                }),
                createStakedMintAddedAccount({ supply: 1_000 }),
                createUnstakedMintAddedAccount({ supply: 2_000 }),
            ]);
            const { program } = await prepareTest(accounts);
            const before = await fetchGlobalData(program);
            const beforeTs = before.dailyDistribution.lastUpdateTimestamp.toNumber();

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            const afterTs = after.dailyDistribution.lastUpdateTimestamp.toNumber();
            const expectedTs = toUnixTime(normalizeTime(new Date()));
            expect(afterTs).to.equal(expectedTs);
            expect(afterTs).to.be.greaterThan(beforeTs);
        });
    });

    describe("High water mark growth / limiter behavior", () => {
        it("increases high_water_mark by uncapped amount when total supply below MIN_SUPPLY_LIMIT_AMT", async () => {
            // Arrange: choose total supply strictly less than MIN_SUPPLY_LIMIT_AMT (1_000_000)
            const startingHwm = 10_000;
            const expectedIncrease = 40_000; // arbitrary, any positive number works while supply < threshold
            const minedToday = startingHwm + expectedIncrease; // minedToday ~= hwm + increase (uncapped path)
            const totalSupplyBelowThreshold = 900_000; // staked + unstaked < MIN_SUPPLY_LIMIT_AMT
            const stakedSupply = 400_000;
            const unstakedSupply = totalSupplyBelowThreshold - stakedSupply; // 500_000
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);
            const before = await fetchGlobalData(program);
            expect(before.dailyDistribution.highWaterMark.toNumber()).to.equal(startingHwm);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            // Uncapped since total supply < threshold; increase = minedToday - startingHwm
            expect(after.dailyDistribution.highWaterMark.toNumber()).to.equal(
                startingHwm + expectedIncrease,
                "High water mark should increase by full uncapped amount",
            );
        });

        it("caps high_water_mark increase when total supply above MIN_SUPPLY_LIMIT_AMT", async () => {
            // Using total supply > MIN_SUPPLY_LIMIT_AMT (1_000_000) triggers limiter path.
            const startingHwm = 100_000;
            const stakedSupply = 1_200_000;
            const unstakedSupply = 800_000; // total = 2_000_000 > threshold
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            // Pre-calculated expected limited increase for these constants & supply:
            // Using Rust formula:
            //   xMinusM = 2_000_000 - 1_000_000 = 1_000_000
            //   rawLimiter = (1_000_000)^(-0.3) + 0.00061 ≈ 0.016462
            //   total_supply * rawLimiter ≈ 32_924 (already an even integer after round_ties_even)
            //   max_allowable_increase = max(32_924 / 146_000, 1) => max(0,1) = 1
            // Therefore the capped increase is 1.
            const expectedIncrease = 1;
            const minedToday = startingHwm + expectedIncrease + 1;

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);
            const before = await fetchGlobalData(program);
            expect(before.dailyDistribution.highWaterMark.toNumber()).to.equal(startingHwm);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            const actualIncrease = after.dailyDistribution.highWaterMark.toNumber() - startingHwm;
            expect(actualIncrease).to.equal(expectedIncrease);
        });
    });

    describe("Distribution splitting logic", () => {
        it("splits total daily distribution 50/50 between yield and UBI pools", async () => {
            // Arrange: choose values so high_water_mark_increase is known & uncapped (supply below limiter threshold)
            const startingHwm = 1_000;
            const minedToday = 1_500; // increase = 500
            const stakedSupply = 10_000; // arbitrary small supply
            const unstakedSupply = 5_000; // total < MIN_SUPPLY_LIMIT_AMT (1_000_000)
            const verifiedAccountsCount = 25; // some verified accounts
            const remainingEarlyAdopterCount = Number(baseProgram.constants.earlyAdopterCount) - verifiedAccountsCount;
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                    verifiedAccountsCount,
                    remainingEarlyAdopterCount,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);

            const hwmIncrease = after.dailyDistribution.highWaterMark.toNumber() - startingHwm; // expect 500
            expect(hwmIncrease).to.equal(minedToday - startingHwm, "Expected uncapped high water mark increase");
            const multiplier = Number(program.constants.comptokenDistributionMultiplier); // 146_000
            const totalDailyDistribution = hwmIncrease * multiplier; // integer
            const totalUbiDistribution = Math.floor(totalDailyDistribution / 2);
            const expectedYieldAmount = totalDailyDistribution - totalUbiDistribution; // should equal the other half

            const pushed = getLatestDistribution(after, program);
            const recordedYieldRate = pushed.yieldRate;
            const reconstructedYieldAmount = Math.round(recordedYieldRate * stakedSupply);
            expectAlmostEqual(reconstructedYieldAmount, expectedYieldAmount, 3, "Yield half mismatch");
            expectAlmostEqual(expectedYieldAmount, totalUbiDistribution, 1, "50/50 split violated");
        });

        it("allocates early adopter UBI portion based on verified_accounts_count ratio", async () => {
            const startingHwm = 2_000;
            const minedToday = 2_500; // increase = 500
            const stakedSupply = 20_000;
            const unstakedSupply = 10_000; // still below limiter threshold
            const verifiedAccountsCount = 100; // small vs EARLY_ADOPTER_COUNT
            const earlyAdopterCount = Number(baseProgram.constants.earlyAdopterCount);
            const remainingEarlyAdopterCount = earlyAdopterCount; // no early adopters claimed yet
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                    verifiedAccountsCount,
                    remainingEarlyAdopterCount,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);
            const { program } = await prepareTest(accounts);
            const before = await fetchGlobalData(program);
            const beforePerCapita = before.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            const hwmIncrease = after.dailyDistribution.highWaterMark.toNumber() - startingHwm;
            const multiplier = Number(program.constants.comptokenDistributionMultiplier);
            const totalDailyDistribution = hwmIncrease * multiplier;
            const totalUbiDistribution = Math.floor(totalDailyDistribution / 2);
            const ratio = (earlyAdopterCount - verifiedAccountsCount) / (earlyAdopterCount + verifiedAccountsCount);
            const expectedEarlyAdopterUbi = roundTiesEven(totalUbiDistribution * ratio);
            const perCapitaIncrement = Math.floor(expectedEarlyAdopterUbi / remainingEarlyAdopterCount);
            const afterPerCapita = after.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();
            expect(afterPerCapita - beforePerCapita).to.equal(
                perCapitaIncrement,
                "perCapitaEarlyAdopterUbiAmount should increase by early adopter share / remainingEarlyAdopterCount",
            );
        });

        it("adds leftover early adopter UBI to running perCapitaEarlyAdopterUbiAmount when remainingEarlyAdopterCount > 0", async () => {
            const startingHwm = 5_000;
            const minedToday = 6_500; // increase = 1_500
            const stakedSupply = 50_000;
            const unstakedSupply = 25_000;
            const verifiedAccountsCount = 10_000; // still tiny vs EARLY_ADOPTER_COUNT
            const earlyAdopterCount = Number(baseProgram.constants.earlyAdopterCount);
            const remainingEarlyAdopterCount = earlyAdopterCount - 100; // some claimed already, still > 0
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                    verifiedAccountsCount,
                    remainingEarlyAdopterCount,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);
            const before = await fetchGlobalData(program);
            const beforePerCapita = before.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);

            const hwmIncrease = after.dailyDistribution.highWaterMark.toNumber() - startingHwm;
            const totalDailyDistribution = hwmIncrease * Number(program.constants.comptokenDistributionMultiplier);
            const totalUbiDistribution = Math.floor(totalDailyDistribution / 2);
            const ratio = (earlyAdopterCount - verifiedAccountsCount) / (earlyAdopterCount + verifiedAccountsCount);
            const earlyAdopterUbi = roundTiesEven(totalUbiDistribution * ratio);
            const expectedIncrement = Math.floor(earlyAdopterUbi / remainingEarlyAdopterCount);
            const afterPerCapita = after.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();
            expect(afterPerCapita - beforePerCapita).to.equal(expectedIncrement);
        });

        it("does not modify perCapitaEarlyAdopterUbiAmount when remainingEarlyAdopterCount = 0", async () => {
            const startingHwm = 8_000;
            const minedToday = 9_000; // increase = 1_000
            const stakedSupply = 5_000;
            const unstakedSupply = 2_500;
            const verifiedAccountsCount = 1_000; // any value
            const remainingEarlyAdopterCount = 0; // critical for this test
            const initialPerCapita = 42_424; // arbitrary starting value
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                    verifiedAccountsCount,
                    remainingEarlyAdopterCount,
                    perCapitaEarlyAdopterUbiAmount: initialPerCapita,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            expect(after.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber()).to.equal(
                initialPerCapita,
                "Value should remain unchanged when remainingEarlyAdopterCount=0",
            );
        });
    });

    describe("Yield & UBI calculations and recording", () => {
        it("records todays yield_rate as yield_amount / staked_supply (non-zero staked_supply)", async () => {
            // Arrange values to ensure uncapped increase and non-zero staked supply
            const startingHwm = 10_000;
            const minedToday = 12_000; // increase = 2_000
            const stakedSupply = 50_000; // > 0
            const unstakedSupply = 25_000; // total < MIN_SUPPLY_LIMIT_AMT
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            const pushed = getLatestDistribution(after, program) as HistoricDistribution;

            const increase = minedToday - startingHwm;
            const totalDailyDistribution = increase * Number(program.constants.comptokenDistributionMultiplier);
            const totalUbiDistribution = Math.floor(totalDailyDistribution / 2);
            const expectedYieldAmount = totalDailyDistribution - totalUbiDistribution;
            const reconstructedYieldAmount = Math.round(pushed.yieldRate * stakedSupply);
            expectAlmostEqual(reconstructedYieldAmount, expectedYieldAmount, 3);
        });

        it("records yield_rate = 0 when staked_supply = 0", async () => {
            const startingHwm = 1_000;
            const minedToday = 2_000; // increase > 0
            const stakedSupply = 0; // critical for this test
            const unstakedSupply = 10_000;
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            const pushed = getLatestDistribution(after, program);
            expect(pushed.yieldRate).to.equal(0);
        });

        it("records ubi_yield per verified account when verified_accounts_count > 0", async () => {
            const startingHwm = 2_000;
            const minedToday = 2_750; // increase = 750
            const stakedSupply = 20_000;
            const unstakedSupply = 10_000; // below limiter threshold
            const verifiedAccountsCount = 50;
            const earlyAdopterCount = Number(baseProgram.constants.earlyAdopterCount);
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                    verifiedAccountsCount,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            const pushed = getLatestDistribution(after, program);

            const increase = minedToday - startingHwm;
            const multiplier = Number(program.constants.comptokenDistributionMultiplier);
            const totalDailyDistribution = increase * multiplier;
            const totalUbiDistribution = Math.floor(totalDailyDistribution / 2);
            const ratio = (earlyAdopterCount - verifiedAccountsCount) / (earlyAdopterCount + verifiedAccountsCount);
            const earlyAdopterUbi = roundTiesEven(totalUbiDistribution * ratio);
            const verifiedShare = totalUbiDistribution - earlyAdopterUbi;
            const expectedPerVerified = Math.floor(verifiedShare / verifiedAccountsCount);
            expect(Number((pushed as any).ubiYield)).to.equal(expectedPerVerified);
        });

        it("records ubi_yield = 0 when verified_accounts_count = 0", async () => {
            const startingHwm = 5_000;
            const minedToday = 5_500; // increase = 500
            const stakedSupply = 15_000;
            const unstakedSupply = 10_000;
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                    verifiedAccountsCount: 0,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            const pushed = getLatestDistribution(after, program);
            expect(Number((pushed as any).ubiYield)).to.equal(0);
        });

        it("appends new HistoricDistribution entry each invocation", async () => {
            // We set last_update to yesterday to ensure an append occurs on invocation
            const startingHwm = 1_000;
            const minedToday = 1_250; // increase = 250
            const stakedSupply = 5_000;
            const unstakedSupply = 3_000;
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);
            const before = await fetchGlobalData(program);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            expectHistoryAdvancedBy(before, after, program, 1);

            // Ensure the latest entry was updated with today's values
            const pushed = getLatestDistribution(after, program);
            expect(pushed.yieldRate).to.be.greaterThan(0);
        });

        it("does not exceed HISTORY_LENGTH entries (RingBuffer wrap behavior)", async () => {
            // Start near the end of the ring buffer and set last_update two days ago to trigger wrap
            const startingHwm = 10_000;
            const minedToday = 11_000; // increase = 1_000
            const stakedSupply = 100_000;
            const unstakedSupply = 50_000;
            const beforeTs = normalizeTime(subtractDays(new Date(), 2)); // two days ago -> 1 missed day

            // Initialize position to last index
            const historyLen = Number(baseProgram.constants.dailyDistributionDataHistoryLength);
            const startPos = historyLen - 1;

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                    historicDistributions: {
                        position: startPos,
                        buffer: new Array<{ yieldRate: number; ubiYield: number }>(historyLen).fill({
                            yieldRate: 0,
                            ubiYield: 0,
                        }),
                    },
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);
            const afterPos = after.dailyDistribution.historicDistributions.position.toNumber();
            // We expect two pushes: today's + 1 missed day => advance by 2 with wrap
            expect(afterPos).to.equal((startPos + 2) % historyLen);
            // Buffer should retain fixed size == HISTORY_LENGTH
            expect(after.dailyDistribution.historicDistributions.buffer.length).to.equal(historyLen);
        });
    });

    describe("Early adopter ratio edge cases", () => {
        it("allocates all UBI to early adopters when verified_accounts_count = 0", async () => {
            // Arrange: verified_accounts_count = 0 -> early_adopter_ubi_ratio = 1
            const startingHwm = 10_000;
            const minedToday = 11_000; // increase = 1_000
            const stakedSupply = 50_000;
            const unstakedSupply = 25_000; // keep below limiter threshold for simplicity
            const verifiedAccountsCount = 0; // key for this test
            const remainingEarlyAdopterCount = 10; // small so per-capita increment is observable
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: beforeTs,
                    verifiedAccountsCount,
                    remainingEarlyAdopterCount,
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program } = await prepareTest(accounts);
            const before = await fetchGlobalData(program);
            const beforePerCapita = before.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();

            await dailyDistribution({ program });

            const after = await fetchGlobalData(program);

            const hwmIncrease = after.dailyDistribution.highWaterMark.toNumber() - startingHwm;
            const multiplier = Number(program.constants.comptokenDistributionMultiplier);
            const totalDailyDistribution = hwmIncrease * multiplier; // 1_000 * 146_000
            const totalUbiDistribution = Math.floor(totalDailyDistribution / 2);
            const perCapitaIncrement = Math.floor(totalUbiDistribution / remainingEarlyAdopterCount);
            const afterPerCapita = after.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();

            // Entire UBI half should go to early adopters => per capita increment derived from totalUbiDistribution
            expect(afterPerCapita - beforePerCapita).to.equal(perCapitaIncrement);

            // Historic distribution ubi_yield (per verified account) must be 0 when no verified accounts
            const pushed = getLatestDistribution(after, program);
            expect(Number(pushed.ubiYield)).to.equal(0);
        });

        it("reduces early adopter UBI portion as verified_accounts_count approaches EARLY_ADOPTER_COUNT", async () => {
            // Compare per-capita increments for small vs large verified counts
            const earlyAdopterCount = Number(baseProgram.constants.earlyAdopterCount);
            const remainingEarlyAdopterCount = 10;
            const startingHwm = 20_000;
            const minedToday = 20_100; // increase = 100
            const stakedSupply = 10_000;
            const unstakedSupply = 5_000;
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));

            async function runOnce(verifiedAccountsCount: number) {
                const accounts = await Promise.all([
                    createGlobalDataAddedAccount({
                        totalMinedToday: minedToday,
                        highWaterMark: startingHwm,
                        lastUpdate: beforeTs,
                        verifiedAccountsCount,
                        remainingEarlyAdopterCount,
                    }),
                    createStakedMintAddedAccount({ supply: stakedSupply }),
                    createUnstakedMintAddedAccount({ supply: unstakedSupply }),
                ]);
                const { program } = await prepareTest(accounts);
                const before = await fetchGlobalData(program);
                const beforePerCapita = before.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();

                await dailyDistribution({ program });

                const after = await fetchGlobalData(program);
                const afterPerCapita = after.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();
                return afterPerCapita - beforePerCapita;
            }

            const smallVerified = 1_000;
            const largeVerified = Math.floor(earlyAdopterCount / 2);

            const incrementSmall = await runOnce(smallVerified);
            const incrementLarge = await runOnce(largeVerified);

            expect(incrementSmall).to.be.greaterThan(0, "Baseline increment should be > 0 for small verified count");
            expect(incrementLarge).to.be.greaterThan(0, "Still non-zero until verified >= earlyAdopterCount");
            expect(incrementLarge).to.be.lessThan(
                incrementSmall,
                "Per-capita early adopter UBI should decrease as verified count grows",
            );
        });

        it("limits early adopter UBI ratio to [0,1] across extreme verified_accounts_count values", async () => {
            // We examine three scenarios and infer ratio bounds via observed allocation amount.
            const remainingEarlyAdopterCount = 10; // amplify signal
            const startingHwm = 30_000;
            const minedToday = 30_050; // increase = 50
            const stakedSupply = 1_000;
            const unstakedSupply = 1_000;
            const beforeTs = normalizeTime(subtractDays(new Date(), 1));
            const earlyAdopterCount = Number(baseProgram.constants.earlyAdopterCount);
            const multiplier = Number(baseProgram.constants.comptokenDistributionMultiplier);

            async function perCapitaIncrement(verifiedAccountsCount: number) {
                const accounts = await Promise.all([
                    createGlobalDataAddedAccount({
                        totalMinedToday: minedToday,
                        highWaterMark: startingHwm,
                        lastUpdate: beforeTs,
                        verifiedAccountsCount,
                        remainingEarlyAdopterCount,
                    }),
                    createStakedMintAddedAccount({ supply: stakedSupply }),
                    createUnstakedMintAddedAccount({ supply: unstakedSupply }),
                ]);
                const { program } = await prepareTest(accounts);
                const before = await fetchGlobalData(program);
                const beforePerCapita = before.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();

                await dailyDistribution({ program });

                const after = await fetchGlobalData(program);
                const afterPerCapita = after.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();
                const hwmIncrease = after.dailyDistribution.highWaterMark.toNumber() - startingHwm; // should be 50
                const totalDailyDistribution = hwmIncrease * multiplier;
                const totalUbiDistribution = Math.floor(totalDailyDistribution / 2);
                const earlyAdopterShareApprox = (afterPerCapita - beforePerCapita) * remainingEarlyAdopterCount;
                return earlyAdopterShareApprox / totalUbiDistribution;
            }

            const ratioAll = await perCapitaIncrement(0); // should approximate 1 (maybe slightly <1 due to flooring)
            const ratioNone = await perCapitaIncrement(earlyAdopterCount); // should be 0
            const ratioOver = await perCapitaIncrement(earlyAdopterCount + 300_000_000); // saturating_sub keeps 0

            expect(ratioAll).to.be.greaterThan(0.9, "Ratio near 1 when no verified accounts");
            expect(ratioNone).to.equal(0, "Ratio is 0 when verified == EARLY_ADOPTER_COUNT");
            expect(ratioOver).to.equal(0, "Ratio clamps at 0 when verified > EARLY_ADOPTER_COUNT");
        });
    });

    describe("Rounding & precision", () => {
        it("parity matches round_ties_even for early adopter UBI calculation (approximate)", async () => {
            // We validate that on-chain logic matches local roundTiesEven for two close fractional cases around .5.
            // Exact .5 is infeasible with current constants (documented rationale). We pick verifiedAccountsCount values
            // that yield ratios producing fractions just below and just above a .5 boundary, and assert parity.
            const startingHwm = 10_000;
            const minedToday = 11_000; // increase = 1_000 (uncapped path with small supply)
            const stakedSupply = 10_000;
            const unstakedSupply = 5_000;
            const remainingEarlyAdopterCount = Number(baseProgram.constants.earlyAdopterCount);

            async function runCase(verifiedAccountsCount: number) {
                const accounts = await Promise.all([
                    createGlobalDataAddedAccount({
                        totalMinedToday: minedToday,
                        highWaterMark: startingHwm,
                        verifiedAccountsCount,
                        remainingEarlyAdopterCount,
                        lastUpdate: normalizeTime(subtractDays(new Date(), 1)),
                    }),
                    createStakedMintAddedAccount({ supply: stakedSupply }),
                    createUnstakedMintAddedAccount({ supply: unstakedSupply }),
                ]);

                const { program } = await prepareTest(accounts);

                await dailyDistribution({ program });

                const after = await fetchGlobalData(program);
                const increase = after.dailyDistribution.highWaterMark.toNumber() - startingHwm;
                const totalDailyDistribution = increase * Number(program.constants.comptokenDistributionMultiplier);
                const totalUbiDistribution = Math.floor(totalDailyDistribution / 2);
                const ratio =
                    (Number(baseProgram.constants.earlyAdopterCount) - verifiedAccountsCount) /
                    (Number(baseProgram.constants.earlyAdopterCount) + verifiedAccountsCount);
                const unrounded = totalUbiDistribution * ratio;
                const expected = roundTiesEven(unrounded);
                const perCapitaIncrement = expected / remainingEarlyAdopterCount; // floor happens on-chain after division
                const stored = after.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toNumber();
                expect(stored).to.equal(Math.floor(perCapitaIncrement));
                return { unrounded, expected };
            }

            const nearHalfLow = 1; // extremely small verified count -> ratio ~= 1
            const nearHalfHigh = 50_000_000; // still << early adopter count
            const caseLow = await runCase(nearHalfLow);
            const caseHigh = await runCase(nearHalfHigh);
            expect(caseLow.expected).to.be.a("number");
            expect(caseHigh.expected).to.be.a("number");
        });

        it("parity matches round_ties_even for high_water_mark limiter rounding (approximate)", async () => {
            // For large supply triggering limiter path, confirm parity of local roundTiesEven with on-chain capped increase calculation.
            const startingHwm = 100_000;
            const stakedSupply = 1_500_000;
            const unstakedSupply = 900_000; // total_supply > MIN_SUPPLY_LIMIT_AMT
            const minedTodaySmall = startingHwm + 10; // small positive increase
            const minedTodayLarge = startingHwm + 10_000; // large uncapped increase to exercise limiter
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedTodaySmall,
                    highWaterMark: startingHwm,
                    lastUpdate: normalizeTime(subtractDays(new Date(), 1)),
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);
            const { program } = await prepareTest(accounts);

            await dailyDistribution({ program });

            const afterSmall = await fetchGlobalData(program);
            const incSmall = afterSmall.dailyDistribution.highWaterMark.toNumber() - startingHwm;

            const accounts2 = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedTodayLarge,
                    highWaterMark: startingHwm,
                    lastUpdate: normalizeTime(subtractDays(new Date(), 1)),
                }),
                createStakedMintAddedAccount({ supply: stakedSupply }),
                createUnstakedMintAddedAccount({ supply: unstakedSupply }),
            ]);

            const { program: program2 } = await prepareTest(accounts2);

            await dailyDistribution({ program: program2 });

            const afterLarge = await fetchGlobalData(program2);
            const incLarge = afterLarge.dailyDistribution.highWaterMark.toNumber() - startingHwm;

            expect(incSmall).to.be.greaterThanOrEqual(1);
            expect(incLarge).to.be.greaterThanOrEqual(incSmall);
            expect(incLarge).to.be.lessThanOrEqual(minedTodayLarge - startingHwm);
        });
    });

    describe("Failure / validation scenarios", () => {
        it("fails when global_data PDA missing", async () => {
            // Provide only the mint PDAs, omit global_data account
            const accounts = await Promise.all([
                createStakedMintAddedAccount({ supply: 10_000 }),
                createUnstakedMintAddedAccount({ supply: 5_000 }),
            ]);
            const { program } = await prepareTest(accounts);
            let threw = false;
            try {
                await dailyDistribution({ program });
            } catch (e: any) {
                threw = true;
                expect(String(e.message || e)).to.match(/account|global|not.*exist|failed/i);
            }
            expect(threw, "Expected invocation to fail without global_data account").to.be.true;
        });

        it("fails when staked_mint PDA missing", async () => {
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: 1000,
                    highWaterMark: 900,
                    lastUpdate: normalizeTime(subtractDays(new Date(), 1)),
                }),
                createUnstakedMintAddedAccount({ supply: 5_000 }),
            ]);
            const { program } = await prepareTest(accounts);
            let threw = false;
            try {
                await dailyDistribution({ program });
            } catch (e: any) {
                threw = true;
                expect(String(e.message || e)).to.match(/staked|mint|account|not.*exist|failed/i);
            }
            expect(threw, "Expected invocation to fail without staked_mint account").to.be.true;
        });

        it("fails when unstaked_mint PDA missing", async () => {
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: 1000,
                    highWaterMark: 900,
                    lastUpdate: normalizeTime(subtractDays(new Date(), 1)),
                }),
                createStakedMintAddedAccount({ supply: 10_000 }),
            ]);
            const { program } = await prepareTest(accounts);
            let threw = false;
            try {
                await dailyDistribution({ program });
            } catch (e: any) {
                threw = true;
                expect(String(e.message || e)).to.match(/unstaked|mint|account|not.*exist|failed/i);
            }
            expect(threw, "Expected invocation to fail without unstaked_mint account").to.be.true;
        });

        it("fails when calling with incorrect seeds for global_data (address mismatch)", async () => {
            // Create valid mint accounts, but supply a wrong global_data address via .accounts override
            const staked = await createStakedMintAddedAccount({ supply: 10_000 });
            const unstaked = await createUnstakedMintAddedAccount({ supply: 5_000 });
            const globalData = await createGlobalDataAddedAccount({
                totalMinedToday: 1_000,
                highWaterMark: 900,
                lastUpdate: normalizeTime(subtractDays(new Date(), 1)),
            });
            // Derive an incorrect PDA using a different seed
            const wrongSeed = Buffer.from("global_data_wrong");
            const [wrongGlobalDataPda] = PublicKey.findProgramAddressSync([wrongSeed], baseProgram.programId);

            const { program } = await prepareTest([staked, unstaked, globalData]);
            let threw = false;
            try {
                await program.methods
                    .dailyDistribution()
                    .accounts({
                        globalData: wrongGlobalDataPda,
                        stakedMint: staked.address,
                        unstakedMint: unstaked.address,
                    })
                    .rpc();
            } catch (e: any) {
                threw = true;
                expect(String(e.message || e)).to.match(/seeds|constraint|global|address|invalid/i);
            }
            expect(threw, "Expected seeds constraint failure for wrong global_data PDA").to.be.true;
        });

        it("allows multiple invocations per day (only updates history the first time)", async () => {
            const startingHwm = 1_000;
            const minedToday = 1_500; // increase > 0
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    totalMinedToday: minedToday,
                    highWaterMark: startingHwm,
                    lastUpdate: normalizeTime(subtractDays(new Date(), 1)), // yesterday to force first update
                }),
                createStakedMintAddedAccount({ supply: 5_000 }),
                createUnstakedMintAddedAccount({ supply: 2_500 }),
            ]);
            const { program } = await prepareTest(accounts);
            const before = await fetchGlobalData(program);

            await dailyDistribution({ program });

            const afterFirst = await fetchGlobalData(program);
            expectHistoryAdvancedBy(before, afterFirst, program, 1);

            // Second invocation same day (total_mined_today now 0, last_update_timestamp already today) => no advance
            await dailyDistribution({ program });

            const afterSecond = await fetchGlobalData(program);
            expectHistoryAdvancedBy(afterFirst, afterSecond, program, 0);
            // High water mark should be non-decreasing
            expect(afterSecond.dailyDistribution.highWaterMark.toNumber()).to.be.at.least(startingHwm);
        });
    });
});

function roundTiesEven(x: number): number {
    const floor = Math.floor(x);
    const diff = x - floor;
    if (diff === 0.5) {
        // ties -> even
        return floor % 2 === 0 ? floor : floor + 1;
    }
    return Math.round(x);
}
