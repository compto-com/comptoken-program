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

export function toUnixTime(date: Date): number {
    return Math.floor(date.getTime() / 1000);
}

export async function prepareTest(accounts: AddedAccount[] = []) {
    // Resolve Anchor workspace root more robustly in ESM/WSL
    const workspaceRoot = process.cwd();
    const context = await startAnchor(workspaceRoot, [], accounts);
    const provider = new BankrunProvider(context);
    const program = getProgramWithConstants(Idl, provider);

    return { context, provider, program };
}
