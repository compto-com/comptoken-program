import { PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { assert } from "console";
import { createHash } from "crypto";

import { bs58, testUser_keypair } from "./common.js";
import { createProofSubmissionInstruction } from "./instruction.js";

const MIN_NUM_ZEROED_BITS = 12;

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

export async function mintComptokens(connection, testuser_pubkey, current_block) {
    let proof = new ComptokenProof(testuser_pubkey, bs58.decode(current_block));
    proof.mine();

    let mintComptokensTransaction = new Transaction();
    mintComptokensTransaction.add(
        await createProofSubmissionInstruction(proof, testUser_keypair.publicKey, testuser_pubkey),
    );
    let mintComptokensResult = await sendAndConfirmTransaction(connection, mintComptokensTransaction, [testUser_keypair, testUser_keypair]);
    console.log("mintComptokens transaction confirmed", mintComptokensResult);
}
