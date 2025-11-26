import { PublicKey } from "@solana/web3.js";

import type { ComptokenProgram } from "@compto/comptoken.js";
import { getGlobalDataAddress, getUserDataAddress } from "@compto/comptoken.js";

import type { GlobalDataAccountData, HistoricDistribution } from "./accountPreinitHelpers.ts";

// Program/account state helpers (non-assertion)

export function getGlobalDataPda(program: ComptokenProgram) {
    return getGlobalDataAddress(program);
}

export async function fetchGlobalData(program: ComptokenProgram) {
    const pda = getGlobalDataPda(program);
    return program.account.globalData.fetch(pda) as Promise<GlobalDataAccountData>;
}

// UserData helpers (mirroring fetchGlobalData style)

export function getUserDataPda(program: ComptokenProgram, userWallet: PublicKey) {
    return getUserDataAddress(program, userWallet);
}

export async function fetchUserData(program: ComptokenProgram, userWallet: PublicKey) {
    const pda = getUserDataPda(program, userWallet);
    return program.account.userData.fetch(pda);
}

export async function fetchUserDataInfo(program: ComptokenProgram, userWallet: PublicKey) {
    const pda = getUserDataPda(program, userWallet);
    return program.provider.connection.getAccountInfo(pda);
}

export async function fetchUserDataSize(program: ComptokenProgram, userWallet: PublicKey) {
    const info = await fetchUserDataInfo(program, userWallet);
    return info?.data.length ?? 0;
}

export function getHistoryLength(program: ComptokenProgram) {
    return Number(program.constants.dailyDistributionDataHistoryLength);
}

export function getHistoryPosition(globalData: GlobalDataAccountData) {
    return globalData.dailyDistribution.historicDistributions.position.toNumber();
}

export function getLatestDistribution(
    globalData: GlobalDataAccountData,
    program: ComptokenProgram,
): HistoricDistribution {
    const historyLen = getHistoryLength(program);
    const pos = getHistoryPosition(globalData);
    const idx = (pos - 1 + historyLen) % historyLen;
    return globalData.dailyDistribution.historicDistributions.buffer[idx] as HistoricDistribution;
}
