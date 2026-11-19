import type { Comptoken } from "../../../target/types/comptoken";
import type { SolanaWorldIdProgram } from "../../../target/types/solana_world_id_program";

// use local comptoken idls instead of the bundled idls
declare module "@compto/comptoken.js" {
    interface Register {
        comptokenIdl: Comptoken;
        solanaWorldIdIdl: SolanaWorldIdProgram;
    }
}
