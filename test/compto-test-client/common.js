import { ComptoPublicKeys } from "@compto/comptoken.js";
import { Keypair } from "@solana/web3.js";

import fs from "fs";
import os from "os";

import * as bs58_ from "bs58";
export const bs58 = bs58_.default;

export const DEFAULT_START_TIME = 1_721_940_656n;
export const DEFAULT_DISTRIBUTION_TIME = 1_721_865_600n; // DEFAULT_START_TIME - DEFAULT_START_TIME % SEC_PER_DAY
export const DEFAULT_ANNOUNCE_TIME = 1_721_865_300n; // DEFAULT_DISTRIBUTION_TIME - (5 * 60) <-- 5 minutes before distribution
export const BIG_NUMBER = 1_000_000_000;
export const COMPTOKEN_DISTRIBUTION_MULTIPLIER = 146000n; // MAGIC NUMBER: remain consistent with constants.rs
export const FUTURE_UBI_VERIFIED_HUMANS = 1_000_000_000; // MAGIC NUMBER: remain consistent with constants.rs
export const MINING_AMOUNT = 100_00n; // MAGIC NUMBER: remain consistent with constants.rs

export const compto_public_keys = ComptoPublicKeys.loadFromCache(import.meta.dirname + "/../.cache");

// KeyPair
let solana_id = JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json").toString());
export const me_keypair = Keypair.fromSecretKey(new Uint8Array(solana_id));
