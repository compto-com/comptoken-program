// Nonce finder for Comptoken mining proofs
// Replicates on-chain hashing and difficulty check to quickly find test nonces.
// Usage (defaults match submitMiningProof.ts test vector and devnet difficulty):
//   node ./scripts/find-nonces.mjs
// Options:
//   --count <n>                            How many nonces to find (default: 1)
//   --start <n>                            Starting nonce (default: 0)
//   --max <n>                              Max iterations to try before stopping (default: 10_000_000)
//   --pubkey <base58>                      User pubkey; if omitted, uses test vector user seed
//   --pubkey-hex <hex>                     32-byte hex pubkey; alternative to --pubkey for hex input
//   --blockhash <hex>                      32-byte hex Solana blockhash (default: 000102...1f)
//   --extra <hex>                          32-byte hex extraData (default: 32 bytes of 00)
//   --version <u32>                        Version as unsigned 32-bit (default: 20)
//   --timestamp <u32>                      Timestamp as unsigned 32-bit (default: 0)

import { Keypair, PublicKey } from "@solana/web3.js";
import { ArgumentParser } from "argparse";
import crypto from "crypto";
import os from "os";

process.env.ANCHOR_WALLET ??= `${os.homedir()}/.config/solana/id.json`; // baseProgram import needs this, but isn't actually used
const { baseProgram } = await import("../accountPreinitHelpers.ts");

type Args = {
    count?: number;
    start?: number;
    maxTries?: number;
    version?: number;
    timestamp?: number;
    pubkey?: string;
    "pubkey-hex"?: `0x${string}`;
    blockhash?: `0x${string}`;
    extra?: `0x${string}`;
};

function hexToBytes(hex: string) {
    const clean = hex.replace(/^0x/, "").toLowerCase();
    if (clean.length % 2 !== 0) {
        throw new Error("hex must have even length");
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function bytesToHex(b: Uint8Array) {
    return Buffer.from(b).toString("hex");
}

function u32le(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0, 0);
    return new Uint8Array(b);
}

function doubleSha256(parts: Uint8Array[]) {
    const h1 = crypto.createHash("sha256");
    for (const p of parts) {
        h1.update(p);
    }
    const first = h1.digest();
    const h2 = crypto.createHash("sha256");
    h2.update(first);
    return new Uint8Array(h2.digest());
}

function reverseBytes(b: Uint8Array) {
    return Uint8Array.from(Array.from(b).reverse());
}

function merkleRoot(extraData: Uint8Array, pubkeyBytes: Uint8Array) {
    return doubleSha256([extraData, pubkeyBytes]);
}

function buildHeader({
    version,
    validBlockhash,
    merkleRoot,
    timestamp,
    nonce,
}: {
    version: Uint8Array;
    validBlockhash: Uint8Array;
    merkleRoot: Uint8Array;
    timestamp: Uint8Array;
    nonce: Uint8Array;
}) {
    const nbits = new Uint8Array([0xd8, 0xad, 0x0e, 0x18]);
    const bh = reverseBytes(validBlockhash);
    const parts = [version, bh, merkleRoot, timestamp, nbits, nonce];
    const len = parts.reduce((a, p) => a + p.length, 0);
    if (len !== 80) throw new Error(`header size mismatch: ${len}`);
    const out = new Uint8Array(80);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

function computeFinalHash(header: Uint8Array) {
    const h = doubleSha256([header]);
    return reverseBytes(h);
}

function cmpBytes(a: Uint8Array, b: Uint8Array) {
    // Lexicographic compare (like Rust's Ord for arrays)
    for (let i = 0; i < 32; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

function parseArgs(argv: string[]) {
    const parser = new ArgumentParser({ description: "Find nonces for Comptoken mining proofs" });
    parser.add_argument("--count", { default: 1, type: "int", help: "How many nonces to find" });
    parser.add_argument("--start", { default: 0, type: "int", help: "Starting nonce" });
    parser.add_argument("--max", { dest: "maxTries", default: 10_000_000, type: "int", help: "Max iterations" });
    parser.add_argument("--version", { default: 536870912, type: "int", help: "Version u32 LE" });
    parser.add_argument("--timestamp", { default: 0, type: "int", help: "Timestamp u32 LE" });
    parser.add_argument("--pubkey", { help: "User pubkey (base58)" });
    parser.add_argument("--pubkey-hex", { help: "32-byte hex pubkey" });
    parser.add_argument("--blockhash", { help: "32-byte hex Solana blockhash (default: 000102..1f)" });
    parser.add_argument("--extra", { help: "32-byte hex extraData (default: 32 bytes of 00)" });
    return parser.parse_args(argv.slice(2)) as Args;
}

function getDefaultPubkeyBytes(args: Args) {
    if (args.pubkey) {
        const pk = new PublicKey(args.pubkey);
        return pk.toBytes();
    }
    if (args["pubkey-hex"]) {
        const pkBytes = hexToBytes(args["pubkey-hex"]!);
        if (pkBytes.length !== 32) {
            throw new Error("--pubkey-hex must be 32 bytes");
        }
        return pkBytes;
    }
    // Default test vector user seed
    const seed = Uint8Array.from([
        163, 81, 164, 86, 62, 89, 43, 120, 231, 223, 81, 41, 255, 0, 3, 98, 151, 236, 77, 132, 181, 2, 19, 112, 35, 17,
        2, 37, 237, 5, 249, 54, 252, 186, 171, 192, 18, 111, 198, 109, 108, 207, 71, 4, 250, 69, 55, 68, 85, 43, 240,
        116, 254, 243, 218, 8, 94, 4, 150, 16, 82, 6, 222, 74,
    ]);
    const user = seed.length === 32 ? Keypair.fromSeed(seed) : Keypair.fromSecretKey(seed);
    return user.publicKey.toBytes();
}

function getDefaultBlockhash(args: Args) {
    const defaultBlockhash = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");
    return hexToBytes(args.blockhash ?? `0x${defaultBlockhash}`);
}

function getDefaultExtra(args: Args) {
    return hexToBytes(args.extra ?? `0x${"00".repeat(32)}`);
}

function main() {
    const args = parseArgs(process.argv);
    const count = Number(args.count ?? 1);
    const start = Number(args.start ?? 0) >>> 0; // Ensure u32 range
    const max = Number(args.maxTries ?? 10_000_000);
    const version = u32le(Number(args.version ?? 20));
    const timestamp = u32le(Number(args.timestamp ?? 0));

    const pubkeyBytes = getDefaultPubkeyBytes(args);
    const validBlockhash = getDefaultBlockhash(args);
    const extraData = getDefaultExtra(args);
    const target = baseProgram.constants.comptokenMiningProofTargetDevnet;

    const mr = merkleRoot(extraData, pubkeyBytes);
    let found = 0;
    let tried = 0;
    let nonceNum = start;

    console.log("Target:", bytesToHex(target));
    console.log("Pubkey:", new PublicKey(pubkeyBytes).toBase58());
    console.log("Blockhash:", bytesToHex(validBlockhash));
    console.log("extraData:", bytesToHex(extraData));
    console.log(`Searching starting at nonce=${nonceNum} for ${count} result(s) (max tries: ${max})...`);

    const results = [];
    while (found < count && tried < max) {
        const nonce = u32le(nonceNum);
        const header = buildHeader({ version, validBlockhash, merkleRoot: mr, timestamp, nonce });
        const finalHash = computeFinalHash(header);
        if (cmpBytes(finalHash, target) < 0) {
            // Emit full rawData vector as used in tests: [pubkey(32), extra(32), nonce(4), version(4), timestamp(4)]
            const rawData = [...pubkeyBytes, ...extraData, ...nonce, ...version, ...timestamp];
            results.push({ nonce: nonceNum >>> 0, finalHash: bytesToHex(finalHash), rawData });
            console.log(`FOUND nonce=${nonceNum >>> 0} finalHash=${bytesToHex(finalHash)}`);
            found++;
        }
        nonceNum = (nonceNum + 1) >>> 0;
        tried++;
    }

    if (results.length === 0) {
        console.log(
            "No nonce found within max iterations. Try increasing --max or using or a larger difficulty number.",
        );
        process.exit(1);
    } else {
        console.log("\nSummary:");
        for (const r of results) {
            console.log(`- nonce=${r.nonce} finalHash=${r.finalHash}`);
            console.log("  rawData:", JSON.stringify(r.rawData));
        }
    }
}

try {
    main();
} catch (e) {
    console.error(e);
    process.exit(1);
}
