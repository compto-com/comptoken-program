import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { expect } from "chai";

import { prepareTest } from "./utils/utils.ts";

describe("initialize", () => {
    it("creates staked/unstaked mints and global data", async () => {
        const { provider, program } = await prepareTest();
        // Derive the mint addresses using the same seeds as in the program
        const [stakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.stakedMintSeed)],
            program.programId,
        );

        const [unstakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.unstakedMintSeed)],
            program.programId,
        );

        // Derive the GlobalData PDA using the same seed as in the program
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId,
        );

        // Execute the initialize instruction
        const ixBuilder = program.methods.initialize().accounts({
            slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        });
        const _sig = await ixBuilder.rpc();

        // Verify the staked mint was created
        const stakedMintInfo = await provider.connection.getAccountInfo(stakedMintPda);
        expect(stakedMintInfo, "Staked mint account should exist").to.not.be.null;
        expect(stakedMintInfo!.owner.toString(), "Staked mint should be owned by Token2022 program").to.equal(
            TOKEN_2022_PROGRAM_ID.toString(),
        );

        // Verify the unstaked mint was created
        const unstakedMintInfo = await provider.connection.getAccountInfo(unstakedMintPda);
        expect(unstakedMintInfo, "Unstaked mint account should exist").to.not.be.null;
        expect(unstakedMintInfo!.owner.toString(), "Unstaked mint should be owned by Token2022 program").to.equal(
            TOKEN_2022_PROGRAM_ID.toString(),
        );

        // Verify account sizes are different (staked mint should be larger due to NonTransferable extension)
        expect(
            stakedMintInfo!.data.length,
            "Staked mint account size should be a mint with NonTransferable extension",
        ).to.equal(170);
        expect(unstakedMintInfo!.data.length, "Unstaked mint account size should be a standard mint").to.equal(82);

        // Additional verification: ensure accounts are properly initialized and not empty
        expect(stakedMintInfo!.data.length).to.be.greaterThan(0);
        expect(unstakedMintInfo!.data.length).to.be.greaterThan(0);
        console.log("✓ Both mints have valid data");

        // Verify the GlobalData account was created and is owned by our program
        const globalDataInfo = await provider.connection.getAccountInfo(globalDataPda);
        expect(globalDataInfo, "GlobalData account should exist").to.not.be.null;
        expect(globalDataInfo!.owner.toString(), "GlobalData should be owned by the comptoken program").to.equal(
            program.programId.toString(),
        );

        // Optionally decode and sanity-check initial GlobalData fields
        const globalData = await program.account.globalData.fetch(globalDataPda);

        // DailyDistributionData starts zeroed and timestamp initialized
        expect(globalData.dailyDistribution.totalMinedToday.toNumber()).to.equal(0);
        expect(globalData.dailyDistribution.highWaterMark.toNumber()).to.equal(0);
        expect(globalData.dailyDistribution.verifiedAccountsCount).to.equal(0);
        expect(globalData.dailyDistribution.lastUpdateTimestamp.toNumber()).to.be.greaterThan(0);

        // ValidBlockhashes should be populated with current network values
        const announced = globalData.validBlockhashes.announcedBlockhash[0];
        const valid = globalData.validBlockhashes.validBlockhash[0];
        expect(Array.isArray(announced) && announced.length === 32, "Announced blockhash must be 32 bytes").to.be.true;
        expect(Array.isArray(valid) && valid.length === 32, "Valid blockhash must be 32 bytes").to.be.true;
        expect(globalData.validBlockhashes.announcedBlockhashTime.toNumber()).to.be.greaterThan(0);
        expect(globalData.validBlockhashes.validBlockhashTime.toNumber()).to.be.greaterThan(0);
        console.log("✓ GlobalData account initialized with expected defaults");
    });
});
