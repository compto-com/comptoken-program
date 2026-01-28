import fs from "fs";

import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { clusterApiUrl, Connection, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { BN } from "bn.js";
import type { Comptoken } from "../target/types/comptoken";
import type { SolanaWorldIdProgram } from "../target/types/solana_world_id_program";

const ROOT_EXPIRY_SECONDS = 86400; // 1 day
const ALLOWED_UPDATE_STALENESS_SECONDS = 5 * 60; // 5 minutes

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const wallet = Wallet.local();
const provider = new AnchorProvider(connection, wallet);

const comptokenIdlJson = fs.readFileSync("./target/idl/comptoken.json", "utf8");
const comptokenIdl = JSON.parse(comptokenIdlJson) as Comptoken;
const comptokenProgram = new Program<Comptoken>(comptokenIdl, provider);

const solanaWorldIdProgramIdlJson = fs.readFileSync("./target/idl/solana_world_id_program.json", "utf8");
const solanaWorldIdProgramIdl = JSON.parse(solanaWorldIdProgramIdlJson) as SolanaWorldIdProgram;
const solanaWorldIdProgram = new Program<SolanaWorldIdProgram>(solanaWorldIdProgramIdl, provider);

console.log(`Comptoken Program ID: ${comptokenProgram.programId.toString()}`);

const result = await comptokenProgram.methods
    .initialize()
    .accounts({
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
    })
    .rpc();

//const result = await comptokenProgram.provider.sendAndConfirm(tx, [comptokenProgram.provider.wallet.payer]);

const logs = await comptokenProgram.provider.connection.getTransaction(result, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
});

console.log("Transaction logs:");
logs?.meta?.logMessages?.forEach((log) => console.log(log));

const solanaWorldIdProgramResult = await solanaWorldIdProgram.methods
    .initialize({
        rootExpirySec: new BN(ROOT_EXPIRY_SECONDS),
        allowedUpdateStalenessSec: new BN(ALLOWED_UPDATE_STALENESS_SECONDS),
    })
    .accounts({})
    .rpc();

const solanaWorldIdProgramLogs = await solanaWorldIdProgram.provider.connection.getTransaction(
    solanaWorldIdProgramResult,
    {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
    },
);

console.log("Solana World ID Program Transaction logs:");
solanaWorldIdProgramLogs?.meta?.logMessages?.forEach((log) => console.log(log));
