import fs from "fs";

import { BorshCoder, type IdlAccounts, Program, type Provider, default as anchor } from "@coral-xyz/anchor";
import type { IdlType, IdlTypeDefined } from "@coral-xyz/anchor/dist/esm/idl.js";
import {
    ACCOUNT_SIZE,
    AccountLayout,
    AccountType,
    ExtensionType,
    MintLayout,
    TOKEN_2022_PROGRAM_ID,
    getAccount,
    getAccountLen,
    getAssociatedTokenAddressSync,
    getMintLen,
} from "@solana/spl-token";
import { Keypair, PublicKey, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import { expect } from "chai";
import { type AddedAccount } from "solana-bankrun";
const { BN } = anchor;
const { bs58 } = anchor.utils.bytes;

import type { Comptoken } from "../target/types/comptoken.ts";

const Idl: Comptoken = JSON.parse(fs.readFileSync("./target/idl/comptoken.json", "utf8"));

const baseProgram = getProgramWithConstants(Idl, undefined as any); // no provider, this should not be used to make calls (just for constants/account data)

const coder = new BorshCoder(Idl);

async function prepareTest(accounts: AddedAccount[] = []) {
    const context = await startAnchor(import.meta.dirname + "/..", [], accounts);
    const provider = new BankrunProvider(context);
    const program = getProgramWithConstants(Idl, provider);

    return { context, provider, program };
}

describe("comptoken", async () => {
    it("initialize: creates staked/unstaked mints and global data", async () => {
        const { provider, program } = await prepareTest();
        // Derive the mint addresses using the same seeds as in the program
        const [stakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.stakedMintSeed)],
            program.programId,
        );

        const [unstakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.unstakedMintSeed)],
            program.programId,
        );

        // Derive the GlobalData PDA using the same seed as in the program
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId,
        );

        // Execute the initialize instruction
        const _tx = await program.methods
            .initialize()
            .accounts({
                slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
            })
            .rpc();

        // Verify the staked mint was created
        const stakedMintInfo = await provider.connection.getAccountInfo(stakedMintPda);
        expect(stakedMintInfo, "Staked mint account should exist").to.not.be.null;
        expect(stakedMintInfo!.owner.toString(), "Staked mint should be owned by Token2022 program").to.equal(
            TOKEN_2022_PROGRAM_ID.toString(),
        );

        // Verify the unstaked mint was created
        const unstakedMintInfo = await provider.connection.getAccountInfo(unstakedMintPda);
        expect(unstakedMintInfo, "Unstaked mint account should exist").to.not.be.null;
        expect(unstakedMintInfo!.owner.toString(), "Unstaked mint should be owned by Token2022 program").to.equal(
            TOKEN_2022_PROGRAM_ID.toString(),
        );

        // Verify account sizes are different (staked mint should be larger due to NonTransferable extension)
        expect(
            stakedMintInfo!.data.length,
            "Staked mint account size should be a mint with NonTransferable extension",
        ).to.equal(170);
        expect(unstakedMintInfo!.data.length, "Unstaked mint account size should be a standard mint").to.equal(82);

        // Additional verification: ensure accounts are properly initialized and not empty
        expect(stakedMintInfo!.data.length).to.be.greaterThan(0);
        expect(unstakedMintInfo!.data.length).to.be.greaterThan(0);
        console.log("✓ Both mints have valid data");

        // Verify the GlobalData account was created and is owned by our program
        const globalDataInfo = await provider.connection.getAccountInfo(globalDataPda);
        expect(globalDataInfo, "GlobalData account should exist").to.not.be.null;
        expect(globalDataInfo!.owner.toString(), "GlobalData should be owned by the comptoken program").to.equal(
            program.programId.toString(),
        );

        // Optionally decode and sanity-check initial GlobalData fields
        const globalData = await program.account.globalData.fetch(globalDataPda);

        // DailyDistributionData starts zeroed and timestamp initialized
        expect(globalData.dailyDistribution.totalMinedToday.toNumber()).to.equal(0);
        expect(globalData.dailyDistribution.highWaterMark.toNumber()).to.equal(0);
        expect(globalData.dailyDistribution.verifiedAccountsCount).to.equal(0);
        expect(globalData.dailyDistribution.lastUpdateTimestamp.toNumber()).to.be.greaterThan(0);

        // ValidBlockhashes should be populated with current network values
        const announced = globalData.validBlockhashes.announcedBlockhash[0];
        const valid = globalData.validBlockhashes.validBlockhash[0];
        expect(Array.isArray(announced) && announced.length === 32, "Announced blockhash must be 32 bytes").to.be.true;
        expect(Array.isArray(valid) && valid.length === 32, "Valid blockhash must be 32 bytes").to.be.true;
        expect(globalData.validBlockhashes.announcedBlockhashTime.toNumber()).to.be.greaterThan(0);
        expect(globalData.validBlockhashes.validBlockhashTime.toNumber()).to.be.greaterThan(0);
        console.log("✓ GlobalData account initialized with expected defaults");
    });

    it("create_user_data_account: creates user data with capacity", async () => {
        const { provider, program } = await prepareTest();
        // Derive the UserData PDA using the same seed as in the program
        const userPubkey = provider.wallet.publicKey;
        const [userDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.userDataSeed), userPubkey.toBuffer()],
            program.programId,
        );

        // Execute the create_user_data instruction
        const _tx = await program.methods
            .createUserDataAccount({ capacity: new BN.BN(10) })
            .accounts({
                payer: userPubkey,
                userWallet: userPubkey,
            })
            .rpc();

        // Verify the UserData account was created and is owned by our program
        const userDataInfo = await provider.connection.getAccountInfo(userDataPda);
        expect(userDataInfo, "UserData account should exist").to.not.be.null;
        expect(userDataInfo!.owner.toString(), "UserData should be owned by the comptoken program").to.equal(
            program.programId.toString(),
        );

        const userData = await program.account.userData.fetch(userDataPda);
        expect(userData.lastClaimedTimestamp.toNumber(), "Last claimed timestamp should be initialized").to.equal(
            normalizeTime(new Date()).getTime() / 1000,
        );
        expect(userData.lastVerifiedTimestamp.toNumber(), "Last verified timestamp should be 0").to.equal(
            new Date(0).getTime() / 1000,
        );
        expect(userData.proofs.length, "Proofs array should be empty").to.equal(0);

        expect(userDataInfo.data.length, "UserData account size should match allocated size").to.equal(
            8 + // discriminator
                8 + // last_claimed_timestamp
                8 + // last_verified_timestamp
                32 + // nullifier_hash
                32 + // recent_blockhash
                4 + // proofs vec length
                10 * 32, // proofs capacity (10) * size of each proof (32 bytes)
        );

        console.log("✓ UserData account initialized with expected defaults");
    });

    it("collect: claims accrued rewards into unstaked account", async () => {
        const user = Keypair.generate();

        const [userDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(baseProgram.constants.userDataSeed), user.publicKey.toBuffer()],
            baseProgram.programId,
        );
        const [stakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(baseProgram.constants.stakedMintSeed)],
            baseProgram.programId,
        );
        const [unstakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(baseProgram.constants.unstakedMintSeed)],
            baseProgram.programId,
        );
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(baseProgram.constants.globalDataSeed)],
            baseProgram.programId,
        );

        const userStakedAta = getAssociatedTokenAddressSync(
            stakedMintPda,
            user.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
        );
        const userUnstakedAta = getAssociatedTokenAddressSync(
            unstakedMintPda,
            user.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
        );

        const accounts = [
            await createUserDataAddedAccount(user.publicKey),
            await createGlobalDataAddedAccount(),
            await createStakedMintAddedAccount(),
            await createUnstakedMintAddedAccount(),
            await createStakedTokenAccountAddedAccount(userStakedAta, user.publicKey),
            await createUnstakedTokenAccountAddedAccount(userUnstakedAta, user.publicKey),
        ];

        const { provider, program } = await prepareTest(accounts);

        // Snapshot balances before collect (expect zeros in a fresh setup)
        const beforeUnstaked = await getAccount(
            provider.connection,
            userUnstakedAta,
            "confirmed",
            TOKEN_2022_PROGRAM_ID,
        );
        const beforeStaked = await getAccount(provider.connection, userStakedAta, "confirmed", TOKEN_2022_PROGRAM_ID);

        const _sig = await program.methods
            .collect()
            .accounts({
                userWallet: user.publicKey,
                userStakedTokenAccount: userStakedAta,
                userUnstakedTokenAccount: userUnstakedAta,
            })
            .signers([user])
            .rpc();

        // Verify no error and state remains consistent
        const afterUnstaked = await getAccount(
            provider.connection,
            userUnstakedAta,
            "confirmed",
            TOKEN_2022_PROGRAM_ID,
        );
        const afterStaked = await getAccount(provider.connection, userStakedAta, "confirmed", TOKEN_2022_PROGRAM_ID);

        // With zero staked principal and no verification UBI, collect should mint 0
        expect(afterUnstaked.amount).to.equal(beforeUnstaked.amount);
        expect(afterStaked.amount).to.equal(beforeStaked.amount);

        const userData = await program.account.userData.fetch(userDataPda);
        // Still "current" (last_claimed at normalized today)
        expect(userData.lastClaimedTimestamp.toNumber()).to.equal(normalizeTime(new Date()).getTime() / 1000);
    });
});

function normalizeTime(time: Date): Date {
    const normalized = new Date(time);
    normalized.setUTCMilliseconds(0);
    normalized.setUTCSeconds(0);
    normalized.setUTCMinutes(0);
    normalized.setUTCHours(0);
    return normalized;
}

type userDataAccountData = IdlAccounts<Comptoken>["userData"];

async function createUserDataAddedAccount(
    userPubkey: PublicKey,
    capacity = 10,
    lastClaimed: Date = new Date("2024-01-01T00:00:00Z"),
    lastVerified: Date = new Date("2024-01-01T00:00:00Z"),
    nullifierHash: Uint8Array = new Uint8Array(32).fill(0),
    recentBlockhash: Uint8Array = new Uint8Array(32).fill(0),
    proofs: Uint8Array[] = new Array<Uint8Array>(capacity).fill(new Uint8Array(32).fill(0)),
): Promise<AddedAccount> {
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

async function createGlobalDataAddedAccount(
    totalMinedToday: number = 0,
    highWaterMark: number = 0,
    earlyAdopterUbiAmount: number = 0,
    verifiedAccountsCount: number = 0,
    remainingEarlyAdopterCount: number = baseProgram.constants.earlyAdopterCount,
    lastUpdate: Date = new Date("2024-01-01T00:00:00Z"),
    historicDistributions: {
        position: number;
        buffer: { yieldRate: number; ubiYield: number }[];
    } = {
        position: 0,
        buffer: new Array<{ yieldRate: number; ubiYield: number }>(
            Number(baseProgram.constants.dailyDistributionDataHistoryLength),
        ).fill({
            yieldRate: 0,
            ubiYield: 0,
        }),
    },
    announcedBlockhash: Uint8Array = new Uint8Array(32).fill(0),
    validBlockhash?: Uint8Array,
): Promise<AddedAccount> {
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

async function createUnstakedMintAddedAccount(supply: number | bigint = 0): Promise<AddedAccount> {
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

async function createStakedMintAddedAccount(supply: number | bigint = 0): Promise<AddedAccount> {
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

async function createUnstakedTokenAccountAddedAccount(
    address: PublicKey,
    owner: PublicKey,
    amount: bigint | number = 0,
): Promise<AddedAccount> {
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

async function createStakedTokenAccountAddedAccount(
    address: PublicKey,
    owner: PublicKey,
    amount: bigint | number = 0,
): Promise<AddedAccount> {
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

// =========================================== type helpers ===========================================

function getConstants<Idl extends anchor.Idl>(program: Program<Idl>): Constants<Program<Idl>["idl"]["constants"]> {
    const rawConstants = program.idl.constants;
    if (!rawConstants) {
        return {} as Constants<Program<Idl>["idl"]["constants"]>;
    }
    const constants: Constants<Program<Idl>["idl"]["constants"]> = {} as any;
    for (const constant of rawConstants) {
        constants[constant.name] = constantToValue(constant);
    }
    return constants;
}

function constantToValue(constant: {
    name: string;
    type: IdlType;
    value: string;
}): number | string | anchor.BN | Uint8Array | PublicKey {
    switch (constant.type) {
        // potentially too big for number
        case "u64":
        case "i64":
        case "u128":
        case "i128":
        case "u256":
        case "i256":
            return new BN(constant.value);

        case "string":
            return constant.value;

        case "pubkey":
            return new PublicKey(constant.value);

        case "bytes":
            return Uint8Array.from(JSON.parse(constant.value));

        case "f64":
        case "f32":
            return parseFloat(constant.value);

        case "u8":
        case "i8":
        case "u16":
        case "i16":
        case "u32":
        case "i32":
            return parseInt(constant.value);

        default:
            if (typeof constant.type === "object" && "defined" in constant.type) {
                return constantDefinedToValue({ ...constant, type: constant.type });
            }
            throw new Error(`Unknown constant type: ${JSON.stringify(constant.type)}`);
    }
}

function constantDefinedToValue(constant: { name: string; type: IdlTypeDefined; value: string }): any {
    switch (constant.type.defined.name) {
        case "hash": {
            // Hash(<hash in base64?>)
            const buf = bs58.decode(constant.value.slice(5, -1));
            return Uint8Array.from(buf);
        }
    }
    throw new Error(`Unknown defined constant type: ${constant.type.defined.name}`);
}

type Constants<ConstantsType extends Program<anchor.Idl>["idl"]["constants"]> = {
    [key in ConstantsType[number] as key["name"]]: key extends {
        type: "u64" | "i64";
    }
        ? bigint
        : key extends {
              type: "string";
          }
        ? string
        : key extends {
              type: "bytes";
          }
        ? Uint8Array
        : key extends {
              type: "f64" | "f32";
          }
        ? number
        : key extends {
              type: "u8" | "i8" | "u16" | "i16" | "u32" | "i32";
          }
        ? number
        : never;
};

type ProgramWithConstants<Idl extends anchor.Idl> = Program<Idl> & {
    constants: Constants<Program<Idl>["idl"]["constants"]>;
};

function getProgramWithConstants<Idl extends anchor.Idl>(idl: Idl, provider: Provider): ProgramWithConstants<Idl> {
    const programWithConstants = new Program<Idl>(idl, provider) as ProgramWithConstants<Idl>;
    programWithConstants.constants = getConstants(programWithConstants);
    return programWithConstants;
}
