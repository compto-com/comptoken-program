import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
    baseProgram,
    createGlobalDataAddedAccount,
    createStakedMintAddedAccount,
    createUnstakedMintAddedAccount,
    type HistoricDistribution,
} from "./utils/accountPreinitHelpers.ts";
import { normalizeTime, prepareTest, subtractDays } from "./utils/utils.ts";

describe.only("daily_distribution", () => {
    // Core success path scenarios
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
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId,
        );

        const beforeGlobal = await program.account.globalData.fetch(globalDataPda);
        const beforePos = beforeGlobal.dailyDistribution.historicDistributions.position.toNumber();

        await program.methods.dailyDistribution().rpc();

        const afterGlobal = await program.account.globalData.fetch(globalDataPda);
        const afterPos = afterGlobal.dailyDistribution.historicDistributions.position.toNumber();
        const historyLen = Number(program.constants.dailyDistributionDataHistoryLength);

        // Position should advance by 1 (ring buffer wrap aware)
        expect(afterPos).to.equal((beforePos + 1) % historyLen);

        const pushedIndex = beforePos; // ring buffer writes at current position then advances
        const pushedEntry = afterGlobal.dailyDistribution.historicDistributions.buffer[
            pushedIndex
        ] as HistoricDistribution;
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
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId,
        );

        const beforeGlobal = await program.account.globalData.fetch(globalDataPda);
        const beforePos = beforeGlobal.dailyDistribution.historicDistributions.position.toNumber();

        await program.methods.dailyDistribution().rpc();

        const afterGlobal = await program.account.globalData.fetch(globalDataPda);
        const afterPos = afterGlobal.dailyDistribution.historicDistributions.position.toNumber();
        const historyLen = Number(program.constants.dailyDistributionDataHistoryLength);

        // Position should advance by 1 (ring buffer wrap aware)
        expect(afterPos).to.equal((beforePos + 1) % historyLen);

        const pushedIndex = beforePos; // ring buffer writes at current position then advances
        const pushedEntry = afterGlobal.dailyDistribution.historicDistributions.buffer[
            pushedIndex
        ] as HistoricDistribution;
        expect(pushedEntry.yieldRate).to.equal(0, "Yield rate should be 0 when not enough mining occurred");
        // ubi_yield may be 0 if no verified accounts; that's fine — ensure high_water_mark grew
        expect(afterGlobal.dailyDistribution.highWaterMark.toNumber()).to.equal(startingHwm);
        // total_mined_today reset
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
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId,
        );
        const beforeGlobal = await program.account.globalData.fetch(globalDataPda);
        const beforePos = beforeGlobal.dailyDistribution.historicDistributions.position.toNumber();

        await program.methods.dailyDistribution().rpc();
        const afterGlobal = await program.account.globalData.fetch(globalDataPda);
        const afterPos = afterGlobal.dailyDistribution.historicDistributions.position.toNumber();
        const historyLen = Number(program.constants.dailyDistributionDataHistoryLength);
        expect(afterPos).to.equal((beforePos + 1) % historyLen);

        const pushedEntry: any = afterGlobal.dailyDistribution.historicDistributions.buffer[beforePos] as any;
        expect(pushedEntry.yieldRate).to.equal(0);
        expect(Number(pushedEntry.ubiYield)).to.equal(0);
        // High water mark unchanged when no mining
        expect(afterGlobal.dailyDistribution.highWaterMark.toNumber()).to.equal(startingHwm);
        // total_mined_today reset (already 0 stays 0)
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
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId,
        );
        const before = await program.account.globalData.fetch(globalDataPda);
        const beforeTs = before.dailyDistribution.lastUpdateTimestamp.toNumber();
        await program.methods.dailyDistribution().rpc();
        const after = await program.account.globalData.fetch(globalDataPda);
        const afterTs = after.dailyDistribution.lastUpdateTimestamp.toNumber();
        const expectedTs = normalizeTime(new Date()).getTime() / 1000;
        expect(afterTs).to.equal(expectedTs);
        expect(afterTs).to.be.greaterThan(beforeTs);
    });

    // High water mark growth / limiter behavior
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
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId,
        );

        const before = await program.account.globalData.fetch(globalDataPda);
        expect(before.dailyDistribution.highWaterMark.toNumber()).to.equal(startingHwm);

        await program.methods.dailyDistribution().rpc();

        const after = await program.account.globalData.fetch(globalDataPda);
        // Uncapped since total supply < threshold; increase = minedToday - startingHwm
        expect(after.dailyDistribution.highWaterMark.toNumber()).to.equal(
            startingHwm + expectedIncrease,
            "High water mark should increase by full uncapped amount",
        );
    });

    it("caps high_water_mark increase when total supply above MIN_SUPPLY_LIMIT_AMT", async () => {
        // We select supplies so that minedToday - startingHwm (uncapped) is large, then verify capped.
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
        const minedToday = startingHwm + expectedIncrease + 1; // minedToday ~= hwm + limited increase

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
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId,
        );

        const before = await program.account.globalData.fetch(globalDataPda);
        expect(before.dailyDistribution.highWaterMark.toNumber()).to.equal(startingHwm);

        await program.methods.dailyDistribution().rpc();
        const after = await program.account.globalData.fetch(globalDataPda);
        const actualIncrease = after.dailyDistribution.highWaterMark.toNumber() - startingHwm;

        expect(actualIncrease).to.equal(expectedIncrease);
    });

    // Distribution splitting logic
    it.skip("splits total daily distribution 50/50 between yield and UBI pools", () => {});
    it.skip("allocates early adopter UBI portion based on verified_accounts_count ratio", () => {});
    it.skip("adds leftover early adopter UBI to running perCapitaEarlyAdopterUbiAmount when remainingEarlyAdopterCount > 0", () => {});
    it.skip("does not modify perCapitaEarlyAdopterUbiAmount when remainingEarlyAdopterCount = 0", () => {});

    // Yield & UBI calculations and recording
    it.skip("records todays yield_rate as yield_amount / staked_supply (non-zero staked_supply)", () => {});
    it.skip("records yield_rate = 0 when staked_supply = 0", () => {});
    it.skip("records ubi_yield per verified account (handles division by zero -> 0)", () => {});
    it.skip("appends new HistoricDistribution entry each invocation", () => {});
    it.skip("does not exceed HISTORY_LENGTH entries (RingBuffer wrap behavior)", () => {});

    // Early adopter ratio edge cases
    it.skip("allocates all UBI to early adopters when verified_accounts_count = 0", () => {});
    it.skip("reduces early adopter UBI portion as verified_accounts_count approaches EARLY_ADOPTER_COUNT", () => {});
    it.skip("limits early adopter UBI ratio to [0,1] across extreme verified_accounts_count values", () => {});

    // Rounding & precision
    it.skip("uses round_ties_even for early adopter UBI calculation", () => {});
    it.skip("uses round_ties_even for high_water_mark increase calculations with large supply", () => {});
    it.skip("uses round_ties_even for yield rate principal application when later queried", () => {});

    // Failure / validation scenarios
    it.skip("fails when global_data PDA missing", () => {});
    it.skip("fails when staked_mint PDA missing", () => {});
    it.skip("fails when unstaked_mint PDA missing", () => {});
    it.skip("fails when calling with incorrect seeds for global_data (address mismatch)", () => {});
    it.skip("allows multiple invocations per day (only updates history the first time)", () => {});
    it.skip("maintains monotonic non-decreasing high_water_mark", () => {});
});
