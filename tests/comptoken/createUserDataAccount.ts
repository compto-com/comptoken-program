import { addresses, transactions } from "@compto/comptoken.js";
import { expect } from "chai";
const { getUserDataAddress } = addresses;
const { createUserDataAccount } = transactions;

import { normalizeTime, prepareTest } from "./utils/utils.ts";

describe("create_user_data_account", async () => {
    it("creates user data with capacity", async () => {
        const { provider, program } = await prepareTest();
        // Derive the UserData PDA using the same seed as in the program
        const user = provider.wallet.payer;
        const userDataPda = getUserDataAddress(program, user.publicKey);

        await createUserDataAccount({
            program,
            capacity: 10,
            accounts: { userWallet: user, payer: user },
        });

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

        expect(userDataInfo!.data.length, "UserData account size should match allocated size").to.equal(
            8 + // discriminator
                8 + // last_claimed_timestamp
                8 + // last_verified_timestamp
                32 + // nullifier_hash
                32 + // recent_blockhash
                4 + // proofs vec length
                10 * 32, // proofs capacity (10) * size of each proof (32 bytes)
        );
    });

    // Stubs for untested aspects of create_user_data_account
    it.skip("fails when called a second time for the same user (PDA already exists)", async () => {});

    it.skip("fails when userWallet is not a signer", async () => {});

    it.skip("fails when payer is not a signer", async () => {});

    it.skip("creates user data with zero capacity (no proofs allowed)", async () => {});

    it.skip("fails when capacity is extremely large and exceeds account size limits", async () => {});

    it.skip("fails when an incorrect userData account address is provided", async () => {});

    it.skip("initializes nullifier_hash and recent_blockhash to zero", async () => {});

    it.skip("payer balance decreases by at least the rent-exempt minimum", async () => {});
});
