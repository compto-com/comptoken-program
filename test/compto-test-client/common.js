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
    DAILY_DISTRIBUTION_EVENT: 4,
};

// Read Cache Files
import global_data_account from "../.cache/compto_global_data_account.json" assert { type: "json" };
export const global_data_account_str = global_data_account["address"];

import comptoken_id from '../.cache/comptoken_mint.json' assert { type: "json" };
export const comptoken_mint_str = comptoken_id["commandOutput"]["address"];

import compto_program_id from '../.cache/compto_program_id.json' assert { type: "json" };
export const compto_program_id_str = compto_program_id['programId'];

import testuser_comptoken_wallet_ from '../.cache/test_user_account.json' assert { type: "json" };
export const testuser_comptoken_wallet_str = testuser_comptoken_wallet_;

// Pubkeys
export const testuser_comptoken_wallet_pubkey = Keypair.fromSecretKey(new Uint8Array(testuser_comptoken_wallet_str)).publicKey;
export const global_data_account_pubkey = new PublicKey(bs58.decode(global_data_account_str));
export const comptoken_mint_pubkey = new PublicKey(bs58.decode(comptoken_mint_str));
export const compto_program_id_pubkey = new PublicKey(bs58.decode(compto_program_id_str));

// KeyPair
let solana_id = JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json").toString());
export const me_keypair = Keypair.fromSecretKey(new Uint8Array(solana_id));
