import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IdlType, IdlTypeDefined } from "@coral-xyz/anchor/dist/cjs/idl";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import { expect } from "chai";
import { Comptoken } from "../target/types/comptoken";

describe("comptoken", () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());

    const program = anchor.workspace.comptoken as Program<Comptoken> & {
        constants: Constants<Program<Comptoken>["idl"]["constants"]>;
    };
    program.constants = getConstants(program);
    const provider = anchor.getProvider();

    it("Is initialized!", async () => {
        // Derive the mint addresses using the same seeds as in the program
        const [stakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.stakedMintSeed)],
            program.programId
        );

        const [unstakedMintPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.unstakedMintSeed)],
            program.programId
        );

        // Derive the GlobalData PDA using the same seed as in the program
        const [globalDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.globalDataSeed)],
            program.programId
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
            TOKEN_2022_PROGRAM_ID.toString()
        );

        // Verify the unstaked mint was created
        const unstakedMintInfo = await provider.connection.getAccountInfo(unstakedMintPda);
        expect(unstakedMintInfo, "Unstaked mint account should exist").to.not.be.null;
        expect(unstakedMintInfo!.owner.toString(), "Unstaked mint should be owned by Token2022 program").to.equal(
            TOKEN_2022_PROGRAM_ID.toString()
        );

        // Verify account sizes are different (staked mint should be larger due to NonTransferable extension)
        expect(
            stakedMintInfo!.data.length,
            "Staked mint account size should be a mint with NonTransferable extension"
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
            program.programId.toString()
        );

        // Optionally decode and sanity-check initial GlobalData fields
        const globalData = await program.account.globalData.fetch(globalDataPda);

        // DailyDistributionData starts zeroed and timestamp initialized
        expect(globalData.dailyDistribution.totalMinedToday.toNumber()).to.equal(0);
        expect(globalData.dailyDistribution.highWaterMark.toNumber()).to.equal(0);
        expect(globalData.dailyDistribution.verifiedAccountsCount).to.equal(0);
        expect(globalData.dailyDistribution.totalVerifiedBalance.toNumber()).to.equal(0);
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

    it("Creates user data account", async () => {
        // Derive the UserData PDA using the same seed as in the program
        const userPubkey = provider.wallet.publicKey;
        const [userDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.userDataSeed), userPubkey.toBuffer()],
            program.programId
        );

        // Execute the create_user_data instruction
        const _tx = await program.methods
            .createUserDataAccount({ capacity: new anchor.BN(10) })
            .accounts({
                payer: userPubkey,
                userWallet: userPubkey,
            })
            .rpc();

        // Verify the UserData account was created and is owned by our program
        const userDataInfo = await provider.connection.getAccountInfo(userDataPda);
        expect(userDataInfo, "UserData account should exist").to.not.be.null;
        expect(userDataInfo!.owner.toString(), "UserData should be owned by the comptoken program").to.equal(
            program.programId.toString()
        );

        const userData = await program.account.userData.fetch(userDataPda);
        expect(userData.lastClaimedTimestamp.toNumber(), "Last claimed timestamp should be initialized").to.equal(
            normalizeTime(new Date()).getTime() / 1000
        );
        expect(userData.lastVerifiedTimestamp.toNumber(), "Last verified timestamp should be 0").to.equal(
            new Date(0).getTime() / 1000
        );
        expect(userData.proofs.length, "Proofs array should be empty").to.equal(0);
        console.log(JSON.stringify(userData.proofs));

        expect(userDataInfo.data.length, "UserData account size should match allocated size").to.equal(
            8 + // discriminator
                8 + // last_claimed_timestamp
                8 + // last_verified_timestamp
                32 + // nullifier_hash
                32 + // recent_blockhash
                4 + // proofs vec length
                10 * 32 // proofs capacity (10) * size of each proof (32 bytes)
        );

        console.log("✓ UserData account initialized with expected defaults");
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
}): number | string | bigint | Uint8Array | PublicKey {
    switch (constant.type) {
        // potentially too big for number
        case "u64":
        case "i64":
        case "u128":
        case "i128":
        case "u256":
        case "i256":
            return BigInt(constant.value);

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
            console.log(buf, buf.length);
            return Uint8Array.from(buf);
        }
    }
    throw new Error(`Unknown defined constant type: ${constant.type.defined.name}`);
}

type Constants<ConstantsType extends anchor.Program<anchor.Idl>["idl"]["constants"]> = {
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
