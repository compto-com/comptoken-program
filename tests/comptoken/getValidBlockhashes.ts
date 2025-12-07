import { utils } from "@compto/comptoken.js";
import { SYSVAR_SLOT_HASHES_PUBKEY, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import { Clock } from "solana-bankrun";
const { decodeValidBlockhashesReturn } = utils;

import {
    baseProgram,
    createGlobalDataAddedAccount,
    createStakedMintAddedAccount,
    createUnstakedMintAddedAccount,
} from "./utils/accountPreinitHelpers.ts";
import { fetchGlobalData } from "./utils/stateHelpers.ts";
import { normalizeTime, prepareTest, subtractDays, toUnixTime } from "./utils/utils.ts";

describe("get_valid_blockhashes", () => {
    describe("Core success path scenarios", () => {
        it("returns the valid blockhash when announced and within the validity window", async () => {
            // Arrange: set both announced and valid within 24h window (fresh)
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({
                    lastUpdate: normalizeTime(new Date()),
                }),
                createStakedMintAddedAccount(),
                createUnstakedMintAddedAccount(),
            ]);

            const { context, program, provider } = await prepareTest(accounts);

            // for some reason can't use .view() here to get return value directly
            // or get the transaction from it's signature with provider.connection.getTransaction,
            // so simulate the transaction instead
            const ix = await program.methods
                .getValidBlockhashes()
                .accounts({ slotHashes: SYSVAR_SLOT_HASHES_PUBKEY })
                .instruction();
            const tx = new Transaction().add(ix);
            const resp = await provider.simulate(tx, [context.payer]);
            const ret = getReturnLog(resp.logs);
            const decoded = decodeValidBlockhashesReturn(program, ret.buffer);

            // Assert: valid is a 32-byte hash and matches account state
            expect(Buffer.isBuffer(decoded.valid) && decoded.valid.length === 32).to.be.true;
            expect(Buffer.isBuffer(decoded.announced) && decoded.announced.length === 32).to.be.true;

            const after = await fetchGlobalData(program);
            expect(decoded.valid).to.deep.equal(Buffer.from(after.validBlockhashes.validBlockhash[0]));
            expect(decoded.announced).to.deep.equal(Buffer.from(after.validBlockhashes.announcedBlockhash[0]));
        });

        it("updates validBlockhash to announcedBlockhash when both are stale (> 24h)", async () => {
            // Arrange: initialize with timestamps 2 days ago so both entries are stale
            const twoDaysAgo = normalizeTime(subtractDays(new Date(), 2));
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({ lastUpdate: twoDaysAgo }),
                createStakedMintAddedAccount(),
                createUnstakedMintAddedAccount(),
            ]);
            const { context, program, provider } = await prepareTest(accounts);

            // see note above about why we simulate
            const builder = program.methods.getValidBlockhashes().accounts({ slotHashes: SYSVAR_SLOT_HASHES_PUBKEY });
            const ix = await builder.instruction();
            const tx = new Transaction().add(ix);
            const resp = await provider.simulate(tx, [context.payer]);
            const ret = getReturnLog(resp.logs);
            const decoded = decodeValidBlockhashesReturn(program, ret.buffer);
            const _sig = await builder.rpc();

            // Assert: returned values equal and non-zero-like
            expect(decoded.valid).to.deep.equal(decoded.announced, "valid should equal announced after refresh");
            expect(allZero(decoded.valid)).to.be.false;

            const after = await fetchGlobalData(program);
            expect(Buffer.from(after.validBlockhashes.validBlockhash[0])).to.deep.equal(decoded.valid);
            expect(Buffer.from(after.validBlockhashes.announcedBlockhash[0])).to.deep.equal(decoded.announced);
        });

        it("does not override an existing validBlockhash before new announcement becomes active", async () => {
            // Arrange: pick a time window where announced is stale but valid isn't yet (5-minute window)
            // Set lastUpdate to exactly yesterday at 00:00 UTC; valid is yesterday 00:05 UTC
            const yesterdayMidnight = normalizeTime(subtractDays(new Date(), 1));
            const accounts = await Promise.all([
                createGlobalDataAddedAccount({ lastUpdate: yesterdayMidnight }), // zeros for both hashes by default
                createStakedMintAddedAccount(),
                createUnstakedMintAddedAccount(),
            ]);
            const { context, program, provider } = await prepareTest(accounts);

            // Move the cluster clock to today 00:01 UTC to be in the window (announced stale, valid not yet stale)
            const todayMidnight = toUnixTime(normalizeTime(new Date()));
            const desiredNow = BigInt(todayMidnight + 60); // +1 minute
            context.setClock(new Clock(0n, 0n, 0n, 0n, desiredNow));

            const before = await fetchGlobalData(program);
            const beforeValid = before.validBlockhashes.validBlockhash[0];

            const builder = program.methods.getValidBlockhashes().accounts({ slotHashes: SYSVAR_SLOT_HASHES_PUBKEY });
            const ix = await builder.instruction();
            const tx = new Transaction().add(ix);
            const resp = await provider.simulate(tx, [context.payer]);
            const retLog = getReturnLog(resp.logs);
            const decoded = decodeValidBlockhashesReturn(program, retLog.buffer);

            const _sig = await builder.rpc();

            const after = await fetchGlobalData(program);
            const afterValid = after.validBlockhashes.validBlockhash[0];

            expect(allZero(decoded.announced)).to.be.false;
            expect(afterValid).to.deep.equal(beforeValid);
        });
    });

    describe("Edge cases and expiration", () => {
        it.skip("expires validBlockhash after the validBlockhashTime passes", async () => {});

        it.skip("handles multiple announced blockhashes with wrap/rotation", async () => {});

        it.skip("tolerates announcedBlockhashTime in the future without immediate activation", async () => {});
    });

    describe("Validation / failure scenarios", () => {
        it.skip("fails when global_data PDA is missing", async () => {});

        it.skip("fails when announcedBlockhash has incorrect length", async () => {});

        it.skip("fails when validBlockhashTime is before announcedBlockhashTime (invalid timestamps)", async () => {});
    });
});

function getReturnLog(logs: string[]) {
    const prefix = "Program return: ";
    let retLog = logs.find((msg) => msg.startsWith(prefix))?.slice(prefix.length);
    if (!retLog) {
        throw new Error("No program return log found");
    }
    const [key, data] = retLog.split(" ", 2);
    const buffer = Buffer.from(data, "base64");
    return { key, data, buffer };
}

function allZero(a: number[] | Buffer): boolean {
    return a.every((b) => b === 0);
}
