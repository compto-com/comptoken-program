import { type Mint, TOKEN_2022_PROGRAM_ID, getMint } from "@solana/spl-token";
import { type AccountInfo, PublicKey, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { BankrunProvider } from "anchor-bankrun";
import { expect } from "chai";

import { type Comptoken } from "../target/types/comptoken.ts";
import {
    createGlobalDataAddedAccount,
    createStakedMintAddedAccount,
    createUnstakedMintAddedAccount,
} from "./utils/accountPreinitHelpers.ts";
import { type ProgramWithConstants } from "./utils/typeHelpers.ts";
import { normalizeTime, prepareTest } from "./utils/utils.ts";

describe("initialize", () => {
    describe("successful initialization", () => {
        let provider: BankrunProvider;
        let program: ProgramWithConstants<Comptoken>;
        let stakedMintPda: PublicKey;
        let unstakedMintPda: PublicKey;
        let globalDataPda: PublicKey;
        let globalDataInfo: AccountInfo<Buffer>;
        let stakedMintInfo: AccountInfo<Buffer>;
        let unstakedMintInfo: AccountInfo<Buffer>;
        let globalData: Awaited<ReturnType<ProgramWithConstants<Comptoken>["account"]["globalData"]["fetch"]>>;
        let stakedMintDecoded: Mint;
        let unstakedMintDecoded: Mint;

        before(async () => {
            ({ provider, program } = await prepareTest());
            [stakedMintPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(program.constants.stakedMintSeed)],
                program.programId,
            );
            [unstakedMintPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(program.constants.unstakedMintSeed)],
                program.programId,
            );
            [globalDataPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(program.constants.globalDataSeed)],
                program.programId,
            );

            // Single initialize call
            await program.methods
                .initialize()
                .accounts({
                    slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
                })
                .rpc();

            // Fetch accounts & decoded data once
            stakedMintInfo = await provider.connection.getAccountInfo(stakedMintPda);
            unstakedMintInfo = await provider.connection.getAccountInfo(unstakedMintPda);
            globalDataInfo = await provider.connection.getAccountInfo(globalDataPda);
            globalData = await program.account.globalData.fetch(globalDataPda);
            stakedMintDecoded = await getMint(provider.connection, stakedMintPda, undefined, TOKEN_2022_PROGRAM_ID);
            unstakedMintDecoded = await getMint(provider.connection, unstakedMintPda, undefined, TOKEN_2022_PROGRAM_ID);
        });

        it("creates staked mint account with correct owner and size", () => {
            expect(stakedMintInfo, "Staked mint account should exist").to.not.be.null;
            expect(stakedMintInfo!.owner.toString(), "Staked mint should be owned by Token2022 program").to.equal(
                TOKEN_2022_PROGRAM_ID.toString(),
            );
            expect(
                stakedMintInfo!.data.length,
                "Staked mint account size should be a mint with NonTransferable extension",
            ).to.equal(170);
        });

        it("creates unstaked mint account with correct owner and size", () => {
            expect(unstakedMintInfo, "Unstaked mint account should exist").to.not.be.null;
            expect(unstakedMintInfo!.owner.toString(), "Unstaked mint should be owned by Token2022 program").to.equal(
                TOKEN_2022_PROGRAM_ID.toString(),
            );
            expect(unstakedMintInfo!.data.length, "Unstaked mint account size should be a standard mint").to.equal(82);
        });

        it("initializes both mints with non-empty data", () => {
            expect(stakedMintInfo!.data.length).to.be.greaterThan(0);
            expect(unstakedMintInfo!.data.length).to.be.greaterThan(0);
        });

        it("creates GlobalData account owned by program", () => {
            expect(globalDataInfo, "GlobalData account should exist").to.not.be.null;
            expect(globalDataInfo!.owner.toString(), "GlobalData should be owned by the comptoken program").to.equal(
                program.programId.toString(),
            );
        });

        it("sets initial daily distribution counters to zero and timestamp > 0", () => {
            expect(globalData.dailyDistribution.totalMinedToday.toNumber()).to.equal(0);
            expect(globalData.dailyDistribution.highWaterMark.toNumber()).to.equal(0);
            expect(globalData.dailyDistribution.verifiedAccountsCount).to.equal(0);
            expect(globalData.dailyDistribution.lastUpdateTimestamp.toNumber()).to.equal(
                normalizeTime(new Date()).getTime() / 1000,
            );
        });

        it("populates valid blockhashes arrays and timestamps", () => {
            const announced = globalData.validBlockhashes.announcedBlockhash[0];
            const valid = globalData.validBlockhashes.validBlockhash[0];
            expect(Array.isArray(announced) && announced.length === 32, "Announced blockhash must be 32 bytes").to.be
                .true;
            expect(Array.isArray(valid) && valid.length === 32, "Valid blockhash must be 32 bytes").to.be.true;
            expect(globalData.validBlockhashes.announcedBlockhashTime.toNumber()).to.be.greaterThan(0);
            expect(globalData.validBlockhashes.validBlockhashTime.toNumber()).to.be.greaterThan(0);
        });

        it("sets mint decimals and authorities correctly", () => {
            expect(stakedMintDecoded.decimals, "Staked mint decimals should equal MINT_DECIMALS (2)").to.equal(
                program.constants.mintDecimals,
            );
            expect(unstakedMintDecoded.decimals, "Unstaked mint decimals should equal MINT_DECIMALS (2)").to.equal(
                program.constants.mintDecimals,
            );
            expect(
                stakedMintDecoded.mintAuthority?.toString(),
                "Staked mint authority should be GlobalData PDA",
            ).to.equal(globalDataPda.toString());
            expect(
                unstakedMintDecoded.mintAuthority?.toString(),
                "Unstaked mint authority should be GlobalData PDA",
            ).to.equal(globalDataPda.toString());
        });

        it("sets no freeze authority on either mint", () => {
            expect(stakedMintDecoded.freezeAuthority, "Staked mint freeze authority should be none").to.be.null;
            expect(unstakedMintDecoded.freezeAuthority, "Unstaked mint freeze authority should be none").to.be.null;
        });

        it("allocates GlobalData account with expected size", () => {
            expect(globalDataInfo!.data.length, "GlobalData account size should match computed layout").to.equal(
                program.account.globalData.size,
            );
        });

        it("initializes remainingEarlyAdopterCount", () => {
            expect(
                globalData.dailyDistribution.remainingEarlyAdopterCount,
                "Remaining early adopter count should be initialized",
            ).to.equal(program.constants.earlyAdopterCount);
        });
    });

    it("fails when initialize invoked on existing mint/global accounts (simulate re-invoke)", async () => {
        // Pre-create the PDAs so the instruction's init constraints should fail
        const preinitializedAccounts = await Promise.all([
            createGlobalDataAddedAccount(),
            createStakedMintAddedAccount(),
            createUnstakedMintAddedAccount(),
        ]);

        const { program } = await prepareTest(preinitializedAccounts);

        let threw = false;
        try {
            await program.methods.initialize().accounts({ slotHashes: SYSVAR_SLOT_HASHES_PUBKEY }).rpc();
        } catch (err: any) {
            threw = true;
            const msg = (err?.error?.errorMessage ?? err?.toString() ?? "").toLowerCase();
            // Anchor may surface either the custom ComptokenError (if it reaches program logic) or a system error like "already in use"
            expect(
                msg.includes("already in use") ||
                    msg.includes("account already initialized") ||
                    msg.includes("accountalreadyinitialized"),
                `Expected an initialization conflict error, got: ${msg}`,
            ).to.be.true;
        }
        expect(threw, "Initialize should fail when accounts already exist").to.be.true;
    });
});
