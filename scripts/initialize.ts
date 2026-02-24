import fs from "fs";

import {
    createComptokenProgram,
    createSolanaWorldIdProgram,
    type ComptokenIdl,
    type SolanaWorldIdIdl,
} from "@compto/comptoken.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { clusterApiUrl, Connection, PublicKey, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { BN } from "bn.js";

const ROOT_EXPIRY_SECONDS = 60 * 60 * 24; // 1 day
const ALLOWED_UPDATE_STALENESS_SECONDS = 60 * 5; // 5 minutes

const url = clusterApiUrl("devnet");
//const url = "http://localhost:8899";
const connection = new Connection(url, "confirmed");
const wallet = Wallet.local();
const provider = new AnchorProvider(connection, wallet);

const comptokenIdlJson = fs.readFileSync("./target/idl/comptoken.json", "utf8");
const comptokenIdl: ComptokenIdl = JSON.parse(comptokenIdlJson);
const comptokenProgram = createComptokenProgram(comptokenIdl, provider);

const solanaWorldIdIdlJson = fs.readFileSync("./target/idl/solana_world_id_program.json", "utf8");
const solanaWorldIdIdl: SolanaWorldIdIdl = JSON.parse(solanaWorldIdIdlJson);
const solanaWorldIdProgram = createSolanaWorldIdProgram(solanaWorldIdIdl, provider);

console.log(`Comptoken program ID: ${comptokenProgram.programId.toBase58()}`);
console.log(`Solana World ID program ID: ${solanaWorldIdProgram.programId.toBase58()}`);

async function makeIdempotent(rpc: () => Promise<string>, programId: PublicKey): Promise<string | null> {
    try {
        return await rpc();
    } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (/already|exists|in use|initialized|duplicate/i.test(msg)) {
            try {
                // try to find the original transaction
                const sigInfos = await connection.getSignaturesForAddress(programId, { limit: 50 });

                for (const sigInfo of sigInfos) {
                    const tx = await connection.getTransaction(sigInfo.signature, {
                        commitment: "confirmed",
                        maxSupportedTransactionVersion: 0,
                    });
                    const logs = tx?.meta?.logMessages;
                    if (logs?.some((log) => /Initialized/.test(log))) {
                        return sigInfo.signature;
                    }
                }
            } catch (e) {
                // ignore errors while searching for the original transaction
            }
            // could not find the original transaction
            return null;
        }

        // rethrow original error if not idempotent case
        throw e;
    }
}

async function getLogsForSignature(signature: string): Promise<string[]> {
    const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
    });
    return tx?.meta?.logMessages ?? [];
}

async function initializeComptoken() {
    const builder = comptokenProgram.methods.initialize().accounts({
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
    });
    const signature = await makeIdempotent(() => builder.rpc(), comptokenProgram.programId);
    // threw if failed, string if succeeded/found original, null if could not find original
    if (signature !== null) {
        return getLogsForSignature(signature);
    }
    // could not find original transaction
    return ["Already initialized, but could not find original transaction."];
}

async function initializeSolanaWorldId() {
    const builder = solanaWorldIdProgram.methods.initialize({
        rootExpirySec: new BN(ROOT_EXPIRY_SECONDS),
        allowedUpdateStalenessSec: new BN(ALLOWED_UPDATE_STALENESS_SECONDS),
    });
    const signature = await makeIdempotent(() => builder.rpc(), solanaWorldIdProgram.programId);
    // threw if failed, string if succeeded/found original, null if could not find original
    if (signature !== null) {
        return getLogsForSignature(signature);
    }
    // could not find original transaction
    return ["Already initialized, but could not find original transaction."];
}

async function main() {
    const comptokenLogs = await initializeComptoken();
    console.log("Comptoken Initialization Logs:");
    comptokenLogs.forEach((log) => console.log(log));

    const solanaWorldIdLogs = await initializeSolanaWorldId();
    console.log("Solana World ID Initialization Logs:");
    solanaWorldIdLogs.forEach((log) => console.log(log));
}

await main();
