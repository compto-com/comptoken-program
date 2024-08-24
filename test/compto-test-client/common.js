import { Keypair, PublicKey, } from "@solana/web3.js";

import fs from "fs";
import os from "os";

import * as bs58_ from "bs58";
export const bs58 = bs58_.default;

export const DEFAULT_START_TIME = 1_721_940_656n;
export const DEFAULT_DISTRIBUTION_TIME = 1_721_865_600n; // DEFAULT_START_TIME - DEFAULT_START_TIME % SEC_PER_DAY
export const DEFAULT_ANNOUNCE_TIME = 1_721_865_300n; // DEFAULT_DISTRIBUTION_TIME - (5 * 60) <-- 5 minutes before distribution
export const SEC_PER_DAY = 86_400n;
export const BIG_NUMBER = 1_000_000_000;
export const COMPTOKEN_DECIMALS = 2; // MAGIC NUMBER: remain consistent with comptoken.rs and common.py
export const COMPTOKEN_DISTRIBUTION_MULTIPLIER = 146000n; // MAGIC NUMBER: remain consistent with constants.rs
export const FUTURE_UBI_VERIFIED_HUMANS = 1_000_000_000; // MAGIC NUMBER: remain consistent with constants.rs
export const MINING_AMOUNT = 10000n; // MAGIC NUMBER: remain consistent with constants.rs

// Read Cache Files
import global_data_account from "../.cache/compto_global_data_account.json" assert { type: "json" };
const global_data_account_str = global_data_account["address"];

import interest_bank_account from "../.cache/compto_interest_bank_account.json" assert { type: "json" };
const interest_bank_account_str = interest_bank_account["address"];

import verified_humanubi_bank_account from "../.cache/compto_verified_human_ubi_bank_account.json" assert { type: "json" };
const verified_human_ubi_bank_account_str = verified_humanubi_bank_account["address"];

import future_ubi_bank_account from "../.cache/compto_future_ubi_bank_account.json" assert { type: "json" };
const future_ubi_bank_account_str = future_ubi_bank_account["address"];

import comptoken_id from "../.cache/comptoken_mint.json" assert { type: "json" };
const comptoken_mint_str = comptoken_id["commandOutput"]["address"];

import compto_program_id from "../.cache/compto_program_id.json" assert { type: "json" };
const compto_program_id_str = compto_program_id["programId"];

import compto_transfer_hook_id from "../.cache/compto_transfer_hook_id.json" assert { type: "json" };
const compto_transfer_hook_id_str = compto_transfer_hook_id["programId"];

import compto_extra_account_metas_account from "../.cache/compto_extra_account_metas_account.json" assert { type: "json" };
const compto_extra_account_metas_account_str = compto_extra_account_metas_account["address"];

import testUser from "../.cache/test_user_account.json" assert { type: "json" };
const testUser_num_arr = testUser;

// Pubkeys
export const testUser_keypair = Keypair.fromSecretKey(new Uint8Array(testUser_num_arr));
export const compto_program_id_pubkey = new PublicKey(bs58.decode(compto_program_id_str));
export const comptoken_mint_pubkey = new PublicKey(bs58.decode(comptoken_mint_str));
export const global_data_account_pubkey = new PublicKey(bs58.decode(global_data_account_str));

export const interest_bank_account_pubkey = new PublicKey(bs58.decode(interest_bank_account_str));
export const verified_human_ubi_bank_account_pubkey = new PublicKey(bs58.decode(verified_human_ubi_bank_account_str));
export const future_ubi_bank_account_pubkey = new PublicKey(bs58.decode(future_ubi_bank_account_str));

export const compto_transfer_hook_id_pubkey = new PublicKey(bs58.decode(compto_transfer_hook_id_str));
export const compto_extra_account_metas_account_pubkey = new PublicKey(bs58.decode(compto_extra_account_metas_account_str));

// KeyPair
let solana_id = JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json").toString());
export const me_keypair = Keypair.fromSecretKey(new Uint8Array(solana_id));
