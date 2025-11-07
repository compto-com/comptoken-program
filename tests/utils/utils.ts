import { BankrunProvider, startAnchor } from "anchor-bankrun";
import { type AddedAccount } from "solana-bankrun";

import { Idl } from "./accountPreinitHelpers.ts";
import { getProgramWithConstants } from "./typeHelpers.ts";

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

export async function prepareTest(accounts: AddedAccount[] = []) {
    console.log("Preparing test environment...");
    // Resolve Anchor workspace root more robustly in ESM/WSL
    const workspaceRoot = process.cwd();
    console.log("Workspace root:", workspaceRoot);
    const context = await startAnchor(workspaceRoot, [], accounts);
    console.log("Anchor context initialized.");
    const provider = new BankrunProvider(context);
    const program = getProgramWithConstants(Idl, provider);

    console.log("Test environment ready.");
    return { context, provider, program };
}
