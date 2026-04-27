// NEW_OWNER=<new_owner_address> NETWORK=testnet WALLET=~/.config/solana/your-key.json npx tsx app/transferOwnership.ts

import { web3 } from "@coral-xyz/anchor";
import { getEnv } from "./env";

const { program } = getEnv();

const programData = web3.PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    new web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
)[0];

async function transferOwnership(newOwner: web3.PublicKey) {
    const tx = await program.methods
        .transferOwnership()
        .accountsPartial({
            newOwner,
            programData,
        })
        .rpc();
    console.log(
        `Successfully initiated ownership transfer to ${newOwner.toString()}: ${tx}`
    );
}

if (typeof require !== "undefined" && require.main === module) {
    if (!process.env.NEW_OWNER) {
        throw new Error("NEW_OWNER is required!");
    }

    transferOwnership(new web3.PublicKey(process.env.NEW_OWNER)).catch(
        (err) => {
            console.error("Error transferring ownership:", err);
            process.exit(1);
        }
    );
}
