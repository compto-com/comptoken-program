import { PublicKey } from "@solana/web3.js";

import type { Comptoken } from "../../target/types/comptoken.ts";
import type { GlobalDataAccountData, HistoricDistribution } from "./accountPreinitHelpers.ts";
import type { ProgramWithConstants } from "./typeHelpers.ts";

// Program/account state helpers (non-assertion)

export function getGlobalDataPda(program: ProgramWithConstants<Comptoken>) {
    const [pda] = PublicKey.findProgramAddressSync([program.constants.globalDataSeed], program.programId);
    return pda;
}

export async function fetchGlobalData(program: ProgramWithConstants<Comptoken>) {
    const pda = getGlobalDataPda(program);
    return program.account.globalData.fetch(pda) as Promise<GlobalDataAccountData>;
}

export function getHistoryLength(program: ProgramWithConstants<Comptoken>) {
    return Number(program.constants.dailyDistributionDataHistoryLength);
}

export function getHistoryPosition(globalData: GlobalDataAccountData) {
    return globalData.dailyDistribution.historicDistributions.position.toNumber();
}

export function getLatestDistribution(
    globalData: GlobalDataAccountData,
    program: ProgramWithConstants<Comptoken>,
): HistoricDistribution {
    const historyLen = getHistoryLength(program);
    const pos = getHistoryPosition(globalData);
    const idx = (pos - 1 + historyLen) % historyLen;
    return globalData.dailyDistribution.historicDistributions.buffer[idx] as HistoricDistribution;
}
