import fs from "fs";

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
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { type AddedAccount } from "solana-bankrun";
const { BN } = anchor;

import type { Comptoken } from "../../target/types/comptoken.ts";
import { getProgramWithConstants } from "./typeHelpers.ts";
import { normalizeTime } from "./utils.ts";

export const Idl: Comptoken = JSON.parse(fs.readFileSync("./target/idl/comptoken.json", "utf8"));
export const baseProgram = getProgramWithConstants(Idl, undefined as any); // no provider, this should not be used to make calls (just for constants/account data)
export const coder = new BorshCoder(Idl);

type userDataAccountData = IdlAccounts<Comptoken>["userData"];

export async function createUserDataAddedAccount({
    userPubkey,
    capacity = 10,
    lastClaimed = normalizeTime(new Date()),
    lastVerified = normalizeTime(new Date(0)),
    nullifierHash = new Uint8Array(32).fill(0),
    recentBlockhash = new Uint8Array(32).fill(0),
    proofs = new Array<Uint8Array>(capacity).fill(new Uint8Array(32).fill(0)),
}: {
    userPubkey: PublicKey;
    capacity?: number;
    lastClaimed?: Date;
    lastVerified?: Date;
    nullifierHash?: Uint8Array;
    recentBlockhash?: Uint8Array;
    proofs?: Uint8Array[];
}): Promise<AddedAccount> {
    expect(proofs.length <= capacity, "Proofs length exceeds capacity");

    const [userDataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(baseProgram.constants.userDataSeed), userPubkey.toBuffer()],
        baseProgram.programId,
    );

    const userData: userDataAccountData = {
        lastClaimedTimestamp: new BN.BN(normalizeTime(lastClaimed).getTime() / 1000),
        lastVerifiedTimestamp: new BN.BN(normalizeTime(lastVerified).getTime() / 1000),
        nullifierHash: { [0]: Array.from(nullifierHash) },
        recentBlockhash: { [0]: Array.from(recentBlockhash) },
        proofs: proofs.map((proof) => ({ [0]: Array.from(proof) })),
    };

    const baseSize = coder.accounts.size("UserData") - 1 + 4; // size adds 1 for variable length fields, plus 4 bytes for the vector length
    const size = baseSize + capacity * 32;
    const data = Buffer.alloc(size);
    let offset = 0;
    data.set(coder.accounts.accountDiscriminator("UserData"));
    offset += 8;
    data.writeBigInt64LE(BigInt(userData.lastClaimedTimestamp.toString()), offset);
    offset += 8;
    data.writeBigInt64LE(BigInt(userData.lastVerifiedTimestamp.toString()), offset);
    offset += 8;
    data.set(userData.nullifierHash[0], offset);
    offset += 32;
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

export type HistoricDistribution = IdlTypes<Comptoken>["historicDistribution"];
export type GlobalDataAccountData = Omit<IdlAccounts<Comptoken>["globalData"], "dailyDistribution"> & {
    dailyDistribution: Omit<IdlAccounts<Comptoken>["globalData"]["dailyDistribution"], "historicDistributions"> & {
        historicDistributions: Omit<
            IdlAccounts<Comptoken>["globalData"]["dailyDistribution"]["historicDistributions"],
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
    remainingEarlyAdopterCount = baseProgram.constants.earlyAdopterCount,
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

    const [globalDataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(baseProgram.constants.globalDataSeed)],
        baseProgram.programId,
    );

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
    const [unstakedMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(baseProgram.constants.unstakedMintSeed)],
        baseProgram.programId,
    );
    const [globalDataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(baseProgram.constants.globalDataSeed)],
        baseProgram.programId,
    );

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
    const [stakedMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(baseProgram.constants.stakedMintSeed)],
        baseProgram.programId,
    );
    const [globalDataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(baseProgram.constants.globalDataSeed)],
        baseProgram.programId,
    );

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
    const [unstakedMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(baseProgram.constants.unstakedMintSeed)],
        baseProgram.programId,
    );

    const data = Buffer.alloc(getAccountLen([]));

    AccountLayout.encode(
        {
            mint: unstakedMintPda,
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
    const [stakedMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(baseProgram.constants.stakedMintSeed)],
        baseProgram.programId,
    );

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
        return obj.toNumber();
    } else if (Array.isArray(obj)) {
        return obj.map((item) => BNtoBigIntRecursive(item));
    } else if (obj !== null && typeof obj === "object") {
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
