// NETWORK=testnet WALLET=~/.config/solana/your-key.json npx tsx app/setRootExpiry.ts

import BN from "bn.js";
import { getEnv } from "./env";

const { program } = getEnv();
async function setRootExpiry(expiryInSecs: BN) {
    const tx = await program.methods.setRootExpiry(expiryInSecs).rpc();
    console.log(
        `Successfully set root expiry (${expiryInSecs.toString()}s): ${tx}`
    );
}

if (typeof require !== "undefined" && require.main === module) {
    setRootExpiry(new BN(60 * 60 * 24 * 7)).catch((err) => {
        console.error("Error setting root expiry:", err);
        process.exit(1);
    });
}
