import { SYSVAR_SLOT_HASHES_PUBKEY, Transaction, TransactionInstruction, sendAndConfirmTransaction, } from '@solana/web3.js';
import * as bs58_ from "bs58";
import { assert } from "console";
import { createHash } from "crypto";
import { Instruction } from "./common.js";
let bs58 = bs58_.default;

const MIN_NUM_ZEROED_BITS = 1;

// Ensure changes to this class remain consistent with comptoken_proof.rs
class ComptokenProof {
    pubkey;
    recentBlockHash; // bs58 encoded string
    nonce; // uint_64
    hash;

    constructor(pubkey, recentBlockHash) {
        this.pubkey = pubkey;
        this.recentBlockHash = recentBlockHash;
        this.nonce = Buffer.alloc(8);
        this.hash = this.generateHash();
    }

    generateHash() {
        let hasher = createHash("sha256");
        hasher.update(this.pubkey.toBuffer());
        hasher.update(bs58.decode(this.recentBlockHash));
        hasher.update(this.nonce);
        return bs58.encode(hasher.digest());
    }

    static leadingZeroes(hash) {
        let leadingZeroes = 0;
        let iter = bs58
            .decode(hash)
            .map((byte) => 8 - byte.toString().replace(/^0*/, "").length);
        for (let i = 0; i < iter.length; ++i) {
            leadingZeroes += iter[i];
            if (iter[i] != 8) {
                break;
            }
        }
        return leadingZeroes;
    }

    mine() {
        while (ComptokenProof.leadingZeroes(this.hash) < MIN_NUM_ZEROED_BITS) {
            this.nonce.writeUInt32BE(this.nonce.readUInt32BE() + 1);
            this.hash = this.generateHash();
        }
    }

    serializeData() {
        let buffer = Buffer.concat([
            bs58.decode(this.recentBlockHash),
            this.nonce,
            bs58.decode(this.hash),
        ]);
        assert(buffer.length == 72);
        return buffer;
    }
}

// under construction
export async function mintComptokens(connection, destination_pubkey, compto_program_id_pubkey, temp_keypair) {
    let proof = new ComptokenProof(destination_pubkey, "11111111111111111111111111111111"); // TODO: get recent_block_hash from caches
    proof.mine();
    let data = Buffer.concat([
        Buffer.from([Instruction.COMPTOKEN_MINT]),
        proof.serializeData(),
    ]);
    let keys = [
        { pubkey: destination_pubkey, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
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
