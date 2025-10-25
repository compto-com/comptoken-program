import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { Comptoken } from "../target/types/comptoken";

describe("comptoken", () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());

    const program = anchor.workspace.comptoken as Program<Comptoken>;
    const provider = anchor.getProvider();

    it("Is initialized!", async () => {
        // Derive the mint addresses using the same seeds as in the program
        const [lockedMintPda] = PublicKey.findProgramAddressSync([Buffer.from("locked_mint")], program.programId);

        const [unlockedMintPda] = PublicKey.findProgramAddressSync([Buffer.from("unlocked_mint")], program.programId);

        // Execute the initialize instruction
        const tx = await program.methods.initialize().rpc();

        // Verify the locked mint was created
        const lockedMintInfo = await provider.connection.getAccountInfo(lockedMintPda);
        expect(lockedMintInfo, "Locked mint account should exist").to.not.be.null;
        expect(lockedMintInfo!.owner.toString(), "Locked mint should be owned by Token2022 program").to.equal(
            TOKEN_2022_PROGRAM_ID.toString()
        );

        // Verify the unlocked mint was created
        const unlockedMintInfo = await provider.connection.getAccountInfo(unlockedMintPda);
        expect(unlockedMintInfo, "Unlocked mint account should exist").to.not.be.null;
        expect(unlockedMintInfo!.owner.toString(), "Unlocked mint should be owned by Token2022 program").to.equal(
            TOKEN_2022_PROGRAM_ID.toString()
        );

        // Verify account sizes are different (locked mint should be larger due to NonTransferable extension)
        expect(
            lockedMintInfo!.data.length,
            "Locked mint account size should be a mint with NonTransferable extension"
        ).to.equal(170);
        expect(unlockedMintInfo!.data.length, "Unlocked mint account size should be a standard mint").to.equal(82);

        // Additional verification: ensure accounts are properly initialized and not empty
        expect(lockedMintInfo!.data.length).to.be.greaterThan(0);
        expect(unlockedMintInfo!.data.length).to.be.greaterThan(0);
        console.log("✓ Both mints have valid data");
    });
});
