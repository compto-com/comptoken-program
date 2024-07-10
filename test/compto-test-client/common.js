import {
    Keypair,
    PublicKey,
} from '@solana/web3.js';

import fs from 'fs';
import os from 'os';

import * as bs58_ from 'bs58';
let bs58 = bs58_.default;

export const Instruction = {
    TEST: 0,
    COMPTOKEN_MINT: 1,
    INITIALIZE_STATIC_ACCOUNT: 2,
    CREATE_USER_DATA_ACCOUNT: 3,
};

// Read Cache Files
import static_pda from "../.cache/compto_static_pda.json" assert { type: "json" };
export const static_pda_str = static_pda["address"];

import comptoken_id from '../.cache/comptoken_id.json' assert { type: "json" };
export const compto_token_id_str = comptoken_id["commandOutput"]["address"];

import compto_program_id from '../.cache/compto_program_id.json' assert { type: "json" };
export const compto_program_id_str = compto_program_id['programId'];

import test_account_ from '../.cache/compto_test_account.json' assert { type: "json" };
export const test_account = test_account_;

// Pubkeys
export const destination_pubkey = Keypair.fromSecretKey(new Uint8Array(test_account)).publicKey;
export const static_pda_pubkey = new PublicKey(bs58.decode(static_pda_str));
export const comptoken_pubkey = new PublicKey(bs58.decode(compto_token_id_str));
export const compto_program_id_pubkey = new PublicKey(bs58.decode(compto_program_id_str));

// KeyPair
let solana_id = JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json").toString());
export const me_keypair = Keypair.fromSecretKey(new Uint8Array(solana_id));
