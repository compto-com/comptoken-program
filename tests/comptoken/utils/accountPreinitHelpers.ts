import {
    type ComptokenIdl,
    type ComptokenProgram,
    type SolanaWorldIdIdl,
    addresses,
    createComptokenProgram,
    createDummyProvider,
    createSolanaWorldIdProgram,
    getComptokenConstants,
    getComptokenIdl,
    getSolanaWorldIdIdl,
} from "@compto/comptoken.js";
import { BorshCoder, type IdlAccounts, type IdlTypes, default as anchor } from "@coral-xyz/anchor";
import {
    ACCOUNT_SIZE,
    type Account,
    AccountLayout,
    AccountState,
    AccountType,
    ExtensionType,
    MintLayout,
    TOKEN_2022_PROGRAM_ID,
    getAccountLen,
    getAssociatedTokenAddressSync,
    getMintLen,
    getAccount as splGetAccount,
    getMint as splGetMint,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import type { AddedAccount } from "solana-bankrun";
const { BN } = anchor;
const {
    getGlobalDataAddress,
    getStakedMintAddress,
    getUnstakedMintAddress,
    getUserDataAddress,
    getWorldIdNullifierAddress,
} = addresses;

import { type CamelToSnakeCaseObject } from "./typeHelpers.ts";
import { normalizeTime, saturatingSubtract, toUnixTime, today } from "./utils.ts";

const projectRoot = `${import.meta.dirname}/../../..`;
export const Idl = getComptokenIdl(`${projectRoot}/target/idl/comptoken.json`);
export const baseProgram = createComptokenProgram(Idl, createDummyProvider());
export const coder = new BorshCoder(Idl);

export const solanaWorldIdIdl = getSolanaWorldIdIdl(`${projectRoot}/target/idl/solana_world_id_program.json`);
export const solanaWorldIdProgram = createSolanaWorldIdProgram(solanaWorldIdIdl, createDummyProvider());
export const solanaWorldIdCoder = new BorshCoder(solanaWorldIdIdl);

type userDataAccountData = IdlAccounts<ComptokenIdl>["userData"];

export async function createWalletAddedAccount(
    address: PublicKey,
    lamports: number = 1_000_000_000,
): Promise<AddedAccount> {
    return {
        address,
        info: {
            executable: false,
            owner: SystemProgram.programId,
            lamports,
            data: Buffer.alloc(0),
            rentEpoch: 0,
        },
    };
}

export async function createUserDataAddedAccount({
    userPubkey,
    capacity = 10,
    lastClaimed = normalizeTime(new Date()),
    lastVerified = normalizeTime(new Date(0)),
    verification = { Unverified: {} },
    recentBlockhash = new Uint8Array(32).fill(0),
    proofs = new Array<Uint8Array>(capacity).fill(new Uint8Array(32).fill(0)),
}: {
    userPubkey: PublicKey;
    capacity?: number;
    lastClaimed?: Date;
    lastVerified?: Date;
    verification?: userDataAccountData["verification"];
    nullifierHash?: Uint8Array;
    recentBlockhash?: Uint8Array;
    proofs?: Uint8Array[];
}): Promise<AddedAccount> {
    expect(proofs.length).to.be.lessThanOrEqual(capacity, "Proofs length exceeds capacity");

    const userDataPda = getUserDataAddress(baseProgram, userPubkey);

    const userData: userDataAccountData = {
        lastClaimedTimestamp: new BN.BN(normalizeTime(lastClaimed).getTime() / 1000),
        lastVerifiedTimestamp: new BN.BN(normalizeTime(lastVerified).getTime() / 1000),
        verification: verification,
        recentBlockhash: { [0]: Array.from(recentBlockhash) },
        proofs: proofs.map((proof) => ({ [0]: Array.from(proof) })),
    };

    const verificationSize = "Unverified" in userData.verification ? 1 : 33; // discriminator (+ Hash for Nullifier/Session) + padding
    const baseSize = coder.accounts.size("UserData") - 1 + 4; // size adds 1 for variable length fields, plus 4 bytes for the vector length
    const size = baseSize + capacity * 32 - 32 + verificationSize; // TODO: remove -32 after updating comptoken.js
    const data = Buffer.alloc(size);
    let offset = 0;
    data.set(coder.accounts.accountDiscriminator("UserData"));
    offset += 8;
    data.writeBigInt64LE(BigInt(userData.lastClaimedTimestamp.toString()), offset);
    offset += 8;
    data.writeBigInt64LE(BigInt(userData.lastVerifiedTimestamp.toString()), offset);
    offset += 8;
    if ("Unverified" in userData.verification) {
        data.writeUInt8(0, offset); // Unverified discriminator
        offset += 1;
        // rest of the Unverified variant has no additional data
    } else if ("Nullifier" in userData.verification) {
        data.writeUInt8(1, offset); // Nullifier discriminator
        offset += 1;
        data.set(userData.verification["Nullifier"].hash[0], offset);
        offset += 32;
    } else if ("Session" in userData.verification) {
        data.writeUInt8(2, offset); // Session discriminator
        offset += 1;
        data.set(userData.verification["Session"].id[0], offset);
        offset += 32;
    } else {
        throw new Error("Unknown verification variant");
    }
    data.set(userData.recentBlockhash[0], offset);
    offset += 32;
    data.writeUInt32LE(proofs.length, offset);
    offset += 4;
    data.set(
        proofs.flatMap((proof) => [...proof]),
        offset,
    );

    expect(offset === size, "Data length mismatch");
    const decoded = coder.accounts.decode("UserData", data);
    expect(snakeToCamelRecursive(BNtoBigIntRecursive(decoded))).to.deep.equal(BNtoBigIntRecursive(userData));

    return {
        address: userDataPda,
        info: {
            owner: baseProgram.programId,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

export type HistoricDistribution = IdlTypes<ComptokenIdl>["historicDistribution"];
export type GlobalDataAccountData = Omit<IdlAccounts<ComptokenIdl>["globalData"], "dailyDistribution"> & {
    dailyDistribution: Omit<IdlAccounts<ComptokenIdl>["globalData"]["dailyDistribution"], "historicDistributions"> & {
        historicDistributions: Omit<
            IdlAccounts<ComptokenIdl>["globalData"]["dailyDistribution"]["historicDistributions"],
            "buffer"
        > & {
            buffer: HistoricDistribution[];
        };
    };
};

export async function createGlobalDataAddedAccount({
    totalMinedToday = 0,
    highWaterMark = 0,
    perCapitaEarlyAdopterUbiAmount = 0,
    verifiedAccountsCount = 0,
    remainingEarlyAdopterCount = saturatingSubtract(baseProgram.constants.earlyAdopterCount, verifiedAccountsCount),
    lastUpdate = normalizeTime(new Date()),
    historicDistributions = {
        position: 0,
        buffer: new Array<{ yieldRate: number; ubiYield: number }>(
            Number(baseProgram.constants.dailyDistributionDataHistoryLength),
        ).fill({
            yieldRate: 0,
            ubiYield: 0,
        }),
    },
    announcedBlockhash = new Uint8Array(32).fill(0),
    validBlockhash,
}: {
    totalMinedToday?: number;
    highWaterMark?: number;
    perCapitaEarlyAdopterUbiAmount?: number;
    verifiedAccountsCount?: number;
    remainingEarlyAdopterCount?: number;
    lastUpdate?: Date;
    historicDistributions?: {
        position: number;
        buffer: { yieldRate: number; ubiYield: number }[];
    };
    announcedBlockhash?: Uint8Array;
    validBlockhash?: Uint8Array;
} = {}): Promise<AddedAccount> {
    if (historicDistributions.buffer.length < Number(baseProgram.constants.dailyDistributionDataHistoryLength)) {
        historicDistributions.buffer = historicDistributions.buffer.concat(
            new Array<{ yieldRate: number; ubiYield: number }>(
                Number(baseProgram.constants.dailyDistributionDataHistoryLength) - historicDistributions.buffer.length,
            ).fill({ yieldRate: 0, ubiYield: 0 }),
        );
    }
    expect(historicDistributions.buffer.length === Number(baseProgram.constants.dailyDistributionDataHistoryLength));

    const globalDataPda = getGlobalDataAddress(baseProgram);

    // Dummy initial data for GlobalData account
    const globalData: GlobalDataAccountData = {
        dailyDistribution: {
            totalMinedToday: new BN(totalMinedToday),
            highWaterMark: new BN(highWaterMark),
            verifiedAccountsCount: verifiedAccountsCount,
            perCapitaEarlyAdopterUbiAmount: new BN(perCapitaEarlyAdopterUbiAmount),
            lastUpdateTimestamp: new BN(normalizeTime(lastUpdate).getTime() / 1000),
            remainingEarlyAdopterCount: remainingEarlyAdopterCount,
            historicDistributions: {
                position: new BN(historicDistributions.position),
                buffer: historicDistributions.buffer.map((entry) => ({
                    yieldRate: entry.yieldRate,
                    ubiYield: new BN(entry.ubiYield),
                })),
            },
        },
        validBlockhashes: {
            announcedBlockhash: { [0]: Array.from(announcedBlockhash) },
            announcedBlockhashTime: new BN(normalizeTime(lastUpdate).getTime() / 1000),
            validBlockhash: { [0]: Array.from(validBlockhash ?? announcedBlockhash) },
            validBlockhashTime: new BN(normalizeTime(lastUpdate).getTime() / 1000 + 300),
        },
    };

    // coder.accounts.encode("GlobalData", globalData) does not work because it is larger than the max buffer size
    // also coder.types.encode(<type>) does not work and I don't know why
    // so we have to encode manually
    const data = Buffer.alloc(coder.accounts.size("GlobalData"));
    let offset = 0;
    data.set(coder.accounts.accountDiscriminator("GlobalData"), offset);
    offset += 8; // discriminator size
    data.writeBigUInt64LE(BigInt(globalData.dailyDistribution.totalMinedToday.toString()), offset);
    offset += 8;
    data.writeBigUInt64LE(BigInt(globalData.dailyDistribution.highWaterMark.toString()), offset);
    offset += 8;
    data.writeBigInt64LE(BigInt(globalData.dailyDistribution.lastUpdateTimestamp.toString()), offset);
    offset += 8;
    data.writeBigUInt64LE(BigInt(globalData.dailyDistribution.perCapitaEarlyAdopterUbiAmount.toString()), offset);
    offset += 8;
    data.writeUInt32LE(globalData.dailyDistribution.verifiedAccountsCount, offset);
    offset += 4;
    data.writeUInt32LE(globalData.dailyDistribution.remainingEarlyAdopterCount, offset);
    offset += 4;
    data.writeBigUInt64LE(BigInt(globalData.dailyDistribution.historicDistributions.position.toString()), offset);
    offset += 8;
    for (const entry of globalData.dailyDistribution.historicDistributions.buffer) {
        const buffer = Buffer.alloc(16);
        buffer.writeDoubleLE(entry.yieldRate, 0);
        buffer.writeBigUInt64LE(BigInt(entry.ubiYield.toString()), 8);
        data.set(buffer, offset);
        offset += 16;
    }
    data.set(globalData.validBlockhashes.announcedBlockhash[0], offset);
    offset += 32;
    data.writeBigInt64LE(BigInt(globalData.validBlockhashes.announcedBlockhashTime.toString()), offset);
    offset += 8;
    data.set(globalData.validBlockhashes.validBlockhash[0], offset);
    offset += 32;
    data.writeBigInt64LE(BigInt(globalData.validBlockhashes.validBlockhashTime.toString()), offset);
    offset += 8;
    expect(offset === data.length, "Data length mismatch");

    const decoded = coder.accounts.decode("GlobalData", data);
    expect(snakeToCamelRecursive(BNtoBigIntRecursive(decoded))).to.deep.equal(BNtoBigIntRecursive(globalData));

    return {
        address: globalDataPda,
        info: {
            owner: baseProgram.programId,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

export async function createUnstakedMintAddedAccount({
    supply = 1_000_000,
}: {
    supply?: number | bigint;
} = {}): Promise<AddedAccount> {
    const unstakedMintPda = getUnstakedMintAddress(baseProgram);
    const globalDataPda = getGlobalDataAddress(baseProgram);

    const data = Buffer.alloc(MintLayout.span);
    MintLayout.encode(
        {
            mintAuthorityOption: 1,
            mintAuthority: globalDataPda,
            supply: BigInt(supply),
            decimals: baseProgram.constants.mintDecimals,
            isInitialized: true,
            freezeAuthorityOption: 0,
            freezeAuthority: PublicKey.default,
        },
        data,
    );

    return {
        address: unstakedMintPda,
        info: {
            owner: TOKEN_2022_PROGRAM_ID,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

export async function createStakedMintAddedAccount({
    supply = 1_000_000,
}: {
    supply?: number | bigint;
} = {}): Promise<AddedAccount> {
    const stakedMintPda = getStakedMintAddress(baseProgram);
    const globalDataPda = getGlobalDataAddress(baseProgram);

    const data = Buffer.alloc(getMintLen([ExtensionType.NonTransferable]));
    MintLayout.encode(
        {
            mintAuthorityOption: 1,
            mintAuthority: globalDataPda,
            supply: BigInt(supply),
            decimals: baseProgram.constants.mintDecimals,
            isInitialized: true,
            freezeAuthorityOption: 0,
            freezeAuthority: PublicKey.default,
        },
        data,
    );
    let offset = ACCOUNT_SIZE; // start after standard account data (this is intentionally not using MintLayout.span, which is smaller)
    // write account type
    data[offset] = AccountType.Mint;
    offset += 1;
    // write extensions
    offset = writeTlvEntry(ExtensionType.NonTransferable, 0, Buffer.alloc(0), data, offset);

    return {
        address: stakedMintPda,
        info: {
            owner: TOKEN_2022_PROGRAM_ID,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

function writeTlvEntry(type: number, length: number, value: Buffer, buffer: Buffer, offset: number): number {
    buffer.writeUInt16LE(type, offset);
    buffer.writeUInt16LE(length, offset + 2);
    value.copy(buffer, offset + 4);
    return offset + 4 + length;
}

export async function createUnstakedTokenAccountAddedAccount({
    address,
    owner,
    amount = 0,
}: {
    address: PublicKey;
    owner: PublicKey;
    amount?: bigint | number;
}): Promise<AddedAccount> {
    const unstakedMintPda = getUnstakedMintAddress(baseProgram);

    const data = Buffer.alloc(getAccountLen([]));

    AccountLayout.encode(
        {
            mint: unstakedMintPda,
            owner,
            amount: BigInt(amount),
            delegateOption: 0,
            delegate: PublicKey.default,
            state: AccountState.Initialized,
            isNativeOption: 0,
            isNative: BigInt(0),
            delegatedAmount: BigInt(0),
            closeAuthorityOption: 0,
            closeAuthority: PublicKey.default,
        },
        data,
    );

    return {
        address,
        info: {
            owner: TOKEN_2022_PROGRAM_ID,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

export async function createStakedTokenAccountAddedAccount({
    owner,
    amount = 0,
}: {
    owner: PublicKey;
    amount?: bigint | number;
}): Promise<AddedAccount> {
    const stakedMintPda = getStakedMintAddress(baseProgram);

    const data = Buffer.alloc(getAccountLen([ExtensionType.NonTransferableAccount, ExtensionType.ImmutableOwner]));

    AccountLayout.encode(
        {
            mint: stakedMintPda,
            owner: owner,
            amount: BigInt(amount),
            delegateOption: 0,
            delegate: PublicKey.default,
            state: AccountState.Initialized,
            isNativeOption: 0,
            isNative: BigInt(0),
            delegatedAmount: BigInt(0),
            closeAuthorityOption: 0,
            closeAuthority: PublicKey.default,
        },
        data,
    );

    let offset = ACCOUNT_SIZE; // start after standard account data
    // write account type
    data[offset] = AccountType.Account;
    offset += 1;
    // write extensions
    offset = writeTlvEntry(ExtensionType.NonTransferableAccount, 0, Buffer.alloc(0), data, offset);
    offset = writeTlvEntry(ExtensionType.ImmutableOwner, 0, Buffer.alloc(0), data, offset);

    const address = getAssociatedTokenAddressSync(stakedMintPda, owner, false, TOKEN_2022_PROGRAM_ID);

    return {
        address,
        info: {
            owner: TOKEN_2022_PROGRAM_ID,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

const VERIFICATION_TYPE = getComptokenConstants().verificationType;

// PDA helpers (use program address from current IDL)
export function getWorldIdRootPdaAndBump(rootHash: Uint8Array) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("Root"), Buffer.from(rootHash), Buffer.from(VERIFICATION_TYPE)],
        solanaWorldIdProgram.programId,
    );
}

export function getWorldIdLatestRootPdaAndBump() {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("LatestRoot"), Buffer.from(VERIFICATION_TYPE)],
        solanaWorldIdProgram.programId,
    );
}

export function getWorldIdConfigPdaAndBump() {
    return PublicKey.findProgramAddressSync([Buffer.from("Config")], solanaWorldIdProgram.programId);
}

export function getWorldIdNullifierPda(nullifierHash: Uint8Array) {
    return getWorldIdNullifierAddress(baseProgram, Buffer.from(nullifierHash));
}

// AddedAccount constructors for Bankrun state seeding

export async function createWorldIdRootAddedAccount({
    rootHash,
    refundRecipient,
    readBlockNumber = 1n,
    readBlockHash = Uint8Array.from({ length: 32 }, (_, i) => (i * 3) & 0xff),
    readBlockTimeUs = BigInt(toUnixTime(today) * 1_000_000),
}: {
    rootHash: Uint8Array;
    refundRecipient: PublicKey;
    readBlockNumber?: bigint;
    readBlockHash?: Uint8Array;
    readBlockTimeUs?: bigint;
}): Promise<AddedAccount> {
    const [address, bump] = getWorldIdRootPdaAndBump(rootHash);

    const accountData: CamelToSnakeCaseObject<IdlTypes<SolanaWorldIdIdl>["root"]> = {
        bump,
        read_block_number: new BN(readBlockNumber),
        read_block_hash: Array.from(readBlockHash),
        read_block_time_us: new BN(readBlockTimeUs),
        refund_recipient: refundRecipient,
        root: Array.from(rootHash),
        verification_type: VERIFICATION_TYPE,
    };

    const data = await solanaWorldIdCoder.accounts.encode("Root", accountData);
    const decoded = solanaWorldIdCoder.accounts.decode("Root", data);
    expect(BNtoBigIntRecursive(decoded)).to.deep.equal(BNtoBigIntRecursive(accountData));

    return {
        address,
        info: {
            owner: solanaWorldIdProgram.programId,
            data,
            executable: false,
            lamports: 1_000_000_000,
        },
    };
}

export async function createWorldIdLatestRootAddedAccount({
    rootHash,
    readBlockNumber = 1n,
    readBlockHash = Uint8Array.from({ length: 32 }, (_, i) => (i * 3) & 0xff),
    readBlockTimeUs = BigInt(toUnixTime(today)),
}: {
    rootHash: Uint8Array;
    readBlockNumber?: bigint;
    readBlockHash?: Uint8Array;
    readBlockTimeUs?: bigint;
}): Promise<AddedAccount> {
    const [address, bump] = getWorldIdLatestRootPdaAndBump();

    const accountData: CamelToSnakeCaseObject<IdlTypes<SolanaWorldIdIdl>["latestRoot"]> = {
        bump,
        read_block_number: new BN(readBlockNumber),
        read_block_hash: Array.from(readBlockHash),
        read_block_time_us: new BN(readBlockTimeUs),
        root: Array.from(rootHash),
        verification_type: VERIFICATION_TYPE,
    };

    const data = await solanaWorldIdCoder.accounts.encode("LatestRoot", accountData);
    const decoded = solanaWorldIdCoder.accounts.decode("LatestRoot", data);
    expect(BNtoBigIntRecursive(decoded)).to.deep.equal(BNtoBigIntRecursive(accountData));

    return {
        address,
        info: {
            owner: solanaWorldIdProgram.programId,
            data,
            executable: false,
            lamports: 1_000_000_000,
        },
    };
}

export async function createWorldIdConfigAddedAccount({
    owner,
    rootExpirySeconds = 2 * 24 * 60 * 60, // 2 days
    allowedUpdateStalenessSeconds = 24 * 60 * 60, // 1 day
}: {
    owner: PublicKey;
    rootExpirySeconds?: number;
    allowedUpdateStalenessSeconds?: number;
}): Promise<AddedAccount> {
    const [address, bump] = getWorldIdConfigPdaAndBump();

    const accountData: CamelToSnakeCaseObject<IdlTypes<SolanaWorldIdIdl>["config"]> = {
        bump,
        owner,
        pending_owner: null,
        root_expiry_sec: new BN(rootExpirySeconds),
        allowed_update_staleness_sec: new BN(allowedUpdateStalenessSeconds),
    };

    const data = await solanaWorldIdCoder.accounts.encode("Config", accountData);
    const decoded = solanaWorldIdCoder.accounts.decode("Config", data);
    decoded.owner = new PublicKey(decoded.owner);
    expect(BNtoBigIntRecursive(decoded)).to.deep.equal(BNtoBigIntRecursive(accountData));

    return {
        address,
        info: {
            owner: solanaWorldIdProgram.programId,
            data,
            executable: false,
            lamports: 1_000_000_000,
        },
    };
}

export async function createWorldIdNullifierAddedAccount({
    nullifierHash,
    userWallet,
    program,
}: {
    nullifierHash: Uint8Array;
    userWallet: PublicKey;
    program: ComptokenProgram;
}): Promise<AddedAccount> {
    const address = getWorldIdNullifierPda(nullifierHash);

    // Matches IDL type "nullifier" (bytemuck C layout)
    const accountData = {
        user_wallet: userWallet,
    };

    const data = await coder.accounts.encode("Nullifier", accountData);
    const decoded: CamelToSnakeCaseObject<IdlTypes<ComptokenIdl>["nullifier"]> = coder.accounts.decode(
        "Nullifier",
        data,
    );
    decoded.user_wallet = new PublicKey(decoded.user_wallet);
    expect(BNtoBigIntRecursive(decoded)).to.deep.equal(BNtoBigIntRecursive(accountData));

    return {
        address,
        info: {
            owner: program.programId,
            data,
            executable: false,
            lamports: 1_000_000_000,
        },
    };
}

export async function buildWorldIdAccountsForVerify({
    userWallet,
    rootHash,
    refundRecipient = userWallet,
}: {
    userWallet: PublicKey;
    rootHash: Uint8Array;
    refundRecipient?: PublicKey;
}): Promise<AddedAccount[]> {
    return [
        await createWorldIdRootAddedAccount({ rootHash, refundRecipient }),
        await createWorldIdLatestRootAddedAccount({ rootHash }),
        await createWorldIdConfigAddedAccount({ owner: userWallet }),
        // Nullifier is created empty on first verify; prefer not to pre-create unless a case needs it
    ];
}

export async function buildWorldIdAccountsWithNullifier({
    userWallet,
    rootHash,
    refundRecipient = userWallet,
    nullifierHash,
    program,
}: {
    userWallet: PublicKey;
    rootHash: Uint8Array;
    refundRecipient?: PublicKey;
    nullifierHash: Uint8Array;
    program: ComptokenProgram;
}): Promise<AddedAccount[]> {
    return [
        ...(await buildWorldIdAccountsForVerify({ userWallet, rootHash, refundRecipient })),
        await createWorldIdNullifierAddedAccount({ userWallet, nullifierHash, program }),
    ];
}

export function getAccount(connection: anchor.web3.Connection, address: anchor.web3.PublicKey): Promise<Account> {
    return splGetAccount(connection, address, "confirmed", TOKEN_2022_PROGRAM_ID);
}

export function getMint(
    connection: anchor.web3.Connection,
    address: anchor.web3.PublicKey,
): Promise<import("@solana/spl-token").Mint> {
    return splGetMint(connection, address, "confirmed", TOKEN_2022_PROGRAM_ID);
}

function BNtoBigIntRecursive(obj: any): any {
    if (obj instanceof BN) {
        return BigInt(obj.toString());
    } else if (Array.isArray(obj)) {
        return obj.map((item) => BNtoBigIntRecursive(item));
    } else if (obj !== null && typeof obj === "object") {
        if (obj instanceof PublicKey) {
            return obj;
        }
        const newObj: any = {};
        for (const key of Object.keys(obj)) {
            newObj[key] = BNtoBigIntRecursive(obj[key]);
        }
        return newObj;
    } else {
        return obj;
    }
}

function snakeToCamelRecursive(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map((item) => snakeToCamelRecursive(item));
    } else if (obj !== null && typeof obj === "object") {
        const newObj: any = {};
        for (const key of Object.keys(obj)) {
            const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
            newObj[camelKey] = snakeToCamelRecursive(obj[key]);
        }
        return newObj;
    } else {
        return obj;
    }
}
