import fs from "fs";
import path from "path";

import { createComptokenProgram, createSolanaWorldIdProgram, type ComptokenProgram as CP } from "@compto/comptoken.js";
import { PublicKey } from "@solana/web3.js";
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import type { AddedAccount } from "solana-bankrun";

import { Idl, solanaWorldIdIdl, type ComptokenProgram } from "./accountPreinitHelpers.ts";
import { RAYDIUM_CP_SWAP_PROGRAM_ID } from "./raydiumHelpers.ts";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/**
 * Accounts for a program deployed (immutably) under the upgradeable loader: the program account, pointing at its
 * programdata account, which holds the ELF after UpgradeableLoaderState::ProgramData's metadata.
 */
function createUpgradeableProgramAddedAccounts(programId: PublicKey, elf: Buffer): AddedAccount[] {
    const [programDataAddress] = PublicKey.findProgramAddressSync(
        [programId.toBuffer()],
        BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );

    const programData = Buffer.alloc(4 + 32);
    programData.writeUInt32LE(2, 0); // UpgradeableLoaderState::Program
    programData.set(programDataAddress.toBuffer(), 4);

    // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> } is always padded
    // to 45 bytes, whether or not there is an upgrade authority
    const PROGRAM_DATA_METADATA_SIZE = 4 + 8 + 1 + 32;
    const programDataData = Buffer.alloc(PROGRAM_DATA_METADATA_SIZE + elf.length);
    programDataData.writeUInt32LE(3, 0); // UpgradeableLoaderState::ProgramData
    // slot 0 and no upgrade authority (immutable) are both already zeroed
    programDataData.set(elf, PROGRAM_DATA_METADATA_SIZE);

    return [
        {
            address: programId,
            info: {
                owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
                data: programData,
                executable: true,
                lamports: 1_000_000_000, // arbitrary lamport amount
            },
        },
        {
            address: programDataAddress,
            info: {
                owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
                data: programDataData,
                executable: false,
                lamports: 1_000_000_000, // arbitrary lamport amount
            },
        },
    ];
}

// our raydium cp-swap fork (compto-com/raydium-cp-swap @ 03cc91dc, default features), which add_liquidity CPIs into.
// added as accounts rather than via startAnchor's extra programs, which only searches for .so files relative to the
// current working directory
const raydiumCpSwapProgram = createUpgradeableProgramAddedAccounts(
    RAYDIUM_CP_SWAP_PROGRAM_ID,
    fs.readFileSync(path.resolve(import.meta.dirname, "../artifacts/raydium_cp_swap.so")),
);

export const today = normalizeTime(new Date());
export const weekAgo = subtractDays(today, 7);

export function normalizeTime(time: Date): Date {
    const normalized = new Date(time);
    normalized.setUTCMilliseconds(0);
    normalized.setUTCSeconds(0);
    normalized.setUTCMinutes(0);
    normalized.setUTCHours(0);
    return normalized;
}

export function subtractDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
}

export function toUnixTime(date: Date): number {
    return Math.floor(date.getTime() / 1000);
}

export async function prepareTest(accounts: AddedAccount[] = []) {
    // Resolve to the repository root so anchor-bankrun can find Anchor.toml and IDLs
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const context = await startAnchor(workspaceRoot, [], [...raydiumCpSwapProgram, ...accounts]);
    const provider = new BankrunProvider(context);
    const program = createComptokenProgram(Idl, provider) as CP & ComptokenProgram;
    const solanaWorldIdProgram = createSolanaWorldIdProgram(solanaWorldIdIdl, provider);
    return { context, provider, program, solanaWorldIdProgram };
}

export function saturatingSubtract(a: number, b: number, min: number = 0): number {
    const val = a - b;
    return val >= min ? val : min;
}
