// NETWORK=testnet WALLET=~/.config/solana/your-key.json npx tsx app/init.ts

import { web3 } from "@coral-xyz/anchor";
import BN from "bn.js";
import { getEnv } from "./env";

const { program } = getEnv();

const programData = web3.PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    new web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
)[0];

async function initialize({
    rootExpirySec,
    allowedUpdateStalenessSec,
}: {
    rootExpirySec: BN;
    allowedUpdateStalenessSec: BN;
}) {
    const tx = await program.methods
        .initialize({
            rootExpirySec,
            allowedUpdateStalenessSec,
        })
        .accountsPartial({
            programData,
        })
        .rpc();
    console.log("Successfully initialized:", tx);
}

if (typeof require !== "undefined" && require.main === module) {
    const twentyFourHours = new BN(24 * 60 * 60);
    const fiveMinutes = new BN(5 * 60);

    initialize({
        rootExpirySec: twentyFourHours,
        allowedUpdateStalenessSec: fiveMinutes,
    }).catch((err) => {
        console.error("Error initializing:", err);
        process.exit(1);
    });
}
