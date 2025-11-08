import { default as anchor } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
const { BN } = anchor;

import { normalizeTime, prepareTest } from "./utils/utils.ts";

describe("comptoken", async () => {
    it("create_user_data_account: creates user data with capacity", async () => {
        const { provider, program } = await prepareTest();
        // Derive the UserData PDA using the same seed as in the program
        const userPubkey = provider.wallet.publicKey;
        const [userDataPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(program.constants.userDataSeed), userPubkey.toBuffer()],
            program.programId,
        );

        // Execute the create_user_data instruction
        const ixBuilder = program.methods.createUserDataAccount({ capacity: new BN(10) }).accounts({
            payer: userPubkey,
            userWallet: userPubkey,
        });
        const _sig = await ixBuilder.rpc();

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
});
