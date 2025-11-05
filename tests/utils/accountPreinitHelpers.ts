import fs from "fs";

import { BorshCoder, type IdlAccounts, default as anchor } from "@coral-xyz/anchor";
import {
    ACCOUNT_SIZE,
    Account,
    AccountLayout,
    AccountType,
    ExtensionType,
    MintLayout,
    TOKEN_2022_PROGRAM_ID,
    getAccountLen,
    getMintLen,
    getAccount as splGetAccount,
    getMint as splGetMint,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { type AddedAccount } from "solana-bankrun";
const { BN } = anchor;

import type { Comptoken } from "../../target/types/comptoken.ts";
import { getProgramWithConstants } from "./typeHelpers.js";
import { normalizeTime } from "./utils.js";

export const Idl: Comptoken = JSON.parse(fs.readFileSync("./target/idl/comptoken.json", "utf8"));
export const baseProgram = getProgramWithConstants(Idl, undefined as any); // no provider, this should not be used to make calls (just for constants/account data)
export const coder = new BorshCoder(Idl);

type userDataAccountData = IdlAccounts<Comptoken>["userData"];

export async function createUserDataAddedAccount({
    userPubkey,
    capacity = 10,
    lastClaimed = new Date("2024-01-01T00:00:00Z"),
    lastVerified = new Date("2024-01-01T00:00:00Z"),
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

    const data = new Uint8Array(8 + 84 + capacity * 32); // discriminator (8) + fixed fields (84) + proofs capacity (capacity * 32)
    data.set(coder.accounts.accountDiscriminator("UserData"));
    data.set(coder.types.encode("UserData", userData), 8);
    data.set(
        proofs.flatMap((proof) => [...proof]),
        8 + 84,
    );

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

type HistoricDistribution = { yieldRate: number; ubiYield: anchor.BN };
type globalDataAccountData = Omit<IdlAccounts<Comptoken>["globalData"], "dailyDistribution"> & {
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
    earlyAdopterUbiAmount = 0,
    verifiedAccountsCount = 0,
    remainingEarlyAdopterCount = baseProgram.constants.earlyAdopterCount,
    lastUpdate = new Date("2024-01-01T00:00:00Z"),
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
    earlyAdopterUbiAmount?: number;
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
    const globalData: globalDataAccountData = {
        dailyDistribution: {
            totalMinedToday: new BN.BN(totalMinedToday),
            highWaterMark: new BN.BN(highWaterMark),
            verifiedAccountsCount: verifiedAccountsCount,
            earlyAdopterUbiAmount: new BN.BN(earlyAdopterUbiAmount),
            lastUpdateTimestamp: new BN.BN(normalizeTime(lastUpdate).getTime() / 1000),
            remainingEarlyAdopterCount: remainingEarlyAdopterCount,
            historicDistributions: {
                position: new BN.BN(historicDistributions.position),
                buffer: historicDistributions.buffer.map((entry) => ({
                    yieldRate: entry.yieldRate,
                    ubiYield: new BN.BN(entry.ubiYield),
                })),
            },
        },
        validBlockhashes: {
            announcedBlockhash: { [0]: Array.from(announcedBlockhash) },
            announcedBlockhashTime: new BN.BN(normalizeTime(lastUpdate).getTime() / 1000),
            validBlockhash: { [0]: Array.from(validBlockhash ?? announcedBlockhash) },
            validBlockhashTime: new BN.BN(normalizeTime(lastUpdate).getTime() / 1000 + 300),
        },
    };

    const data = new Uint8Array(coder.accounts.size("GlobalData"));
    data.set(coder.accounts.accountDiscriminator("GlobalData"));
    data.set(coder.types.encode("DailyDistributionData", globalData.dailyDistribution), 8); // only allocates 1000 bytes, so cuts out some data
    data.set(
        globalData.dailyDistribution.historicDistributions.buffer.flatMap((val) => [
            ...coder.types.encode("HistoricDistribution", val),
        ]),
        8 + 32 + 8, // discriminator (8) + daily dist data w/out history (32) + position (8)
    );
    data.set(
        coder.types.encode(
            "comptoken::state::global_data::valid_blockhashes::ValidBlockhashes",
            globalData.validBlockhashes,
        ),
        8 + 32 + 8 + historicDistributions.buffer.length * 16, // discriminator (8) + daily dist data w/out history (32) + position (8) + history (length * 16)
    );

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
    buffer.writeUInt8(type, offset);
    buffer.writeUInt16LE(length, offset + 1);
    value.copy(buffer, offset + 3);
    return offset + 3 + length;
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
            state: 1, // initialized
            isNativeOption: 0,
            isNative: BigInt(0),
            delegatedAmount: BigInt(0),
            closeAuthorityOption: 0,
            closeAuthority: PublicKey.default,
        },
        data,
    );

    return {
        address: address,
        info: {
            owner: TOKEN_2022_PROGRAM_ID,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

export async function createStakedTokenAccountAddedAccount({
    address,
    owner,
    amount = 0,
}: {
    address: PublicKey;
    owner: PublicKey;
    amount?: bigint | number;
}): Promise<AddedAccount> {
    const [stakedMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(baseProgram.constants.stakedMintSeed)],
        baseProgram.programId,
    );

    const data = Buffer.alloc(getAccountLen([ExtensionType.NonTransferableAccount]));

    AccountLayout.encode(
        {
            mint: stakedMintPda,
            owner: owner,
            amount: BigInt(amount),
            delegateOption: 0,
            delegate: PublicKey.default,
            state: 1, // initialized
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

    return {
        address: address,
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
