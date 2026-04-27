import path from "path";

import { createComptokenProgram, createSolanaWorldIdProgram } from "@compto/comptoken.js";
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import type { AddedAccount } from "solana-bankrun";

import { Idl, solanaWorldIdIdl } from "./accountPreinitHelpers.ts";

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
    const context = await startAnchor(workspaceRoot, [], accounts);
    const provider = new BankrunProvider(context);
    const program = createComptokenProgram(Idl, provider);
    const solanaWorldIdProgram = createSolanaWorldIdProgram(solanaWorldIdIdl, provider);
    return { context, provider, program, solanaWorldIdProgram };
}

export function saturatingSubtract(a: number, b: number, min: number = 0): number {
    const val = a - b;
    return val >= min ? val : min;
}
