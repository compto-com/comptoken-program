import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { assert } from "console";
import { createHash } from "crypto";

import { bs58, compto_program_id_pubkey, comptoken_mint_pubkey, global_data_account_pubkey } from "./common.js";
import { Instruction } from "./instruction.js";

const MIN_NUM_ZEROED_BITS = 3;

// Ensure changes to this class remain consistent with comptoken_proof.rs
export class ComptokenProof {
    pubkey; // PublicKey
    recentBlockHash; // Uint8Array
    nonce; // uint_64
    hash; // buffer

    /**
     * 
     * @param {PublicKey} pubkey 
     * @param {Uint8Array} recentBlockHash
     */
    constructor(pubkey, recentBlockHash) {
        this.pubkey = pubkey;
        this.recentBlockHash = recentBlockHash;
        this.nonce = Buffer.alloc(8);
        this.hash = this.generateHash();
    }

    /**
     * 
     * @returns {Buffer}
     */
    generateHash() {
        let hasher = createHash("sha256");
        hasher.update(this.pubkey.toBuffer());
        hasher.update(this.recentBlockHash);
        hasher.update(this.nonce);
        return hasher.digest();
    }

    /**
     * 
     * @param {Buffer} hash 
     * @returns {number}
     */
    static leadingZeroes(hash) {
        let numZeroes = 0;
        for (let i = 0; i < hash.length; i++) {
            let byte = hash[i];
            if (byte == 0) {
                numZeroes += 8;
            } else {
                let mask = 0x80; // 10000000
                // mask > 0 is defensive, not technically necessary
                // because the above if case checks for all 0's
                while (mask > 0 && (byte & mask) == 0) {
                    numZeroes += 1;
                    mask >>= 1;
                }
                break;
            }
        }
        return numZeroes;
    }

    mine() {
        while (ComptokenProof.leadingZeroes(this.hash) < MIN_NUM_ZEROED_BITS) {
            this.nonce.writeUInt32LE(this.nonce.readUInt32LE() + 1);
            this.hash = this.generateHash();
        }
    }

    /**
     * 
     * @returns {Buffer}
     */
    serializeData() {
        let buffer = Buffer.concat([
            this.recentBlockHash,
            this.nonce,
            this.hash,
        ]);
        assert(buffer.length == 72);
        return buffer;
    }
}

export async function mintComptokens(connection, destination_pubkey, temp_keypair, current_block) {
    let proof = new ComptokenProof(destination_pubkey, bs58.decode(current_block));
    proof.mine();
    let data = Buffer.concat([
        Buffer.from([Instruction.PROOF_SUBMISSION]),
        proof.serializeData(),
    ]);
    let user_data_pda = PublicKey.findProgramAddressSync([destination_pubkey.toBytes()], compto_program_id_pubkey)[0];
    let keys = [
        { pubkey: comptoken_mint_pubkey, isSigner: false, isWritable: true },
        { pubkey: destination_pubkey, isSigner: false, isWritable: true },
        { pubkey: global_data_account_pubkey, isSigner: false, isWritable: false},
        { pubkey: user_data_pda, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    let mintComptokensTransaction = new Transaction();
    mintComptokensTransaction.add(new TransactionInstruction({
        keys: keys,
        programId: compto_program_id_pubkey,
        data: data,
    }));
    let mintComptokensResult = await sendAndConfirmTransaction(connection, mintComptokensTransaction, [temp_keypair, temp_keypair]);
    console.log("mintComptokens transaction confirmed", mintComptokensResult);
}
