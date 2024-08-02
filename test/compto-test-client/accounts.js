import { ACCOUNT_SIZE, AccountLayout, AccountState, MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import solana_bankrun from "solana-bankrun";
const { AccountInfoBytes } = solana_bankrun;

import {
    compto_program_id_pubkey, comptoken_mint_pubkey, DEFAULT_ANNOUNCE_TIME, DEFAULT_DISTRIBUTION_TIME, global_data_account_pubkey,
    interest_bank_account_pubkey, ubi_bank_account_pubkey,
} from "./common.js";

export const BIG_NUMBER = 1_000_000_000;
export const COMPTOKEN_DECIMALS = 0; // MAGIC NUMBER: remain consistent with comptoken.rs and full_deploy_test.py

// =============================== Helper functions ===============================
/**
 *
 * @param {bigint} int
 * @returns {number[]}
 */
export function bigintAsU64ToBytes(int) {
    let arr = new Array(8);
    for (let i = 0; int > 0n; ++i) {
        arr[i] = Number(int & 255n);
        int >>= 8n;
    }
    return arr;
}

/**
 *
 * @param {number} num
 * @returns {number[]}
 */
export function numAsDouble2LEBytes(num) {
    let buffer = Buffer.alloc(8);
    buffer.writeDoubleLE(num);
    return Array.from({ length: 8 }, (v, i) => buffer.readUint8(i));
}

/**
 *
 * @param {Uint8Array} bytes
 * @param {number} elem_size
 * @returns {Uint8Array[]}
 */
function LEBytes2SplitArray(bytes, elem_size) {
    let len = bytes.length / elem_size;
    let arr = new Array(len);
    for (let i = 0; i < len; ++i) {
        arr[i] = bytes.subarray(i * elem_size, i * elem_size + elem_size);
    }
    return arr;
}

/**
 *
 * @param {Uint8Array} bytes
 * @returns {number[]}
 */
export function LEBytes2DoubleArray(bytes) {
    return LEBytes2SplitArray(bytes, 8).map((elem) => new DataView(elem.buffer.slice(elem.byteOffset)).getFloat64(0, true));
}

/**
 * 
 * @param {Uint8Array} bytes 
 * @returns {Uint8Array[]}
 */
export function LEBytes2BlockhashArray(bytes) {
    return LEBytes2SplitArray(bytes, 32);
}

/**
 *
 * @param {T | null | undefined} val
 * @returns {T | null}
 */
export function toOption(val) {
    if (val === undefined || typeof val === "undefined") {
        return null;
    }
    return val;
}

/**
 *
 * @param {T | null} opt_val
 * @param {() => T} fn
 * @returns {T} opt_val if it is not null or result of calling fn
 */
export function getOptionOr(opt_val, fn) {
    if (opt_val === null) {
        return { option: 0, val: fn() };
    }
    return { option: 1, val: opt_val };
}

/**
 * 
 * @param {T[]} left 
 * @param {T[]} right 
 * @returns {boolean}
 */
export function isArrayEqual(left, right) {
    if (left.length != right.length) {
        return false;
    }
    for (let i = 0; i < left.length; ++i) {
        if (left[i] != right[i]) {
            return false;
        }
    }
    return true;
}

// =============================== Classes ===============================
export class MintAccount {
    address; //  PublicKey
    lamports; //  u64
    owner; // PublicKey
    supply; //  u64
    decimals; //  u8
    mintAuthority; //  optional PublicKey
    freezeAuthority; //  optional PublicKey

    /**
     *
     * @param {PublicKey} address
     * @param {number} lamports
     * @param {bigint} supply
     * @param {number} decimals
     * @param {PublicKey | null} mintAuthority
     * @param {PublicKey | null} freezeAuthority
     */
    constructor(address, lamports, supply, decimals, mintAuthority = null, freezeAuthority = null) {
        this.address = address;
        this.lamports = lamports;
        this.owner = TOKEN_2022_PROGRAM_ID
        this.supply = supply;
        this.decimals = decimals;
        this.mintAuthority = toOption(mintAuthority);
        this.freezeAuthority = toOption(freezeAuthority);
    }

    /**
     *
     * @returns {AddedAccount}
     */
    toAccount() {
        const { option: freezeAuthorityOption, val: freezeAuthority } = getOptionOr(this.freezeAuthority, () => PublicKey.default);
        const { option: mintAuthorityOption, val: mintAuthority } = getOptionOr(this.mintAuthority, () => PublicKey.default);

        let buffer = new Uint8Array(MINT_SIZE);
        MintLayout.encode(
            {
                mintAuthorityOption,
                mintAuthority,
                supply: this.supply,
                decimals: this.decimals,
                isInitialized: true,
                freezeAuthorityOption,
                freezeAuthority,
            },
            buffer,
        );

        return {
            address: this.address,
            info: {
                lamports: this.lamports,
                data: buffer,
                owner: this.owner,
                executable: false,
            },
        };
    }

    /**
     *
     * @param {PublicKey} address
     * @param {AccountInfoBytes} accountInfo
     * @returns {MintAccount}
     */
    static fromAccountInfoBytes(address, accountInfo) {
        let rawMint = MintLayout.decode(accountInfo.data);
        return new MintAccount(
            address,
            accountInfo.lamports,
            rawMint.supply,
            rawMint.decimals,
            rawMint.mintAuthorityOption === 1 ? rawMint.mintAuthority : null,
            rawMint.freezeAuthorityOption === 1 ? rawMint.freezeAuthority : null,
        );
    }
}
export class ValidBlockhashes {
    announcedBlockhash; //  blockhash
    announcedBlockhashTime; //  i64
    validBlockhash; //  blockhash
    validBlockhashTime; //  i64

    /**
     *
     * @param {{ blockhash: Uint8Array; time: bigint }} announced
     * @param {{ blockhash: Uint8Array; time: bigint }} valid
     */
    constructor(announced, valid) {
        this.announcedBlockhash = announced.blockhash;
        this.announcedBlockhashTime = announced.time;
        this.validBlockhash = valid.blockhash;
        this.validBlockhashTime = valid.time;
    }

    /**
     *
     * @returns {Uint8Array}
     */
    toBytes() {
        return new Uint8Array([
            ...this.announcedBlockhash,
            ...bigintAsU64ToBytes(this.announcedBlockhashTime),
            ...this.validBlockhash,
            ...bigintAsU64ToBytes(this.validBlockhashTime),
        ]);
    }

    /**
     *
     * @param {Uint8Array} bytes
     * @returns {ValidBlockhashes}
     */
    static fromBytes(bytes) {
        const dataView = new DataView(bytes.buffer.slice(bytes.byteOffset));
        return new ValidBlockhashes(
            { blockhash: bytes.subarray(0, 32), time: dataView.getBigInt64(32, true) },
            { blockhash: bytes.subarray(40, 72), time: dataView.getBigInt64(72, true) },
        );
    }
}

export class DailyDistributionData {
    yesterdaySupply; //  u64
    highWaterMark; //  u64
    lastDailyDistributionTime; //  i64
    oldestInterest; //  usize
    historicInterests; //  [f64; 365]

    static HISTORY_SIZE = 365; //   remain consistent with rust

    /**
     *
     * @param {bigint} yesterdaySupply
     * @param {bigint} highWaterMark
     * @param {bigint} lastDailyDistributionTime
     * @param {bigint} oldestInterest
     * @param {number[]} historicInterests
     */
    constructor(yesterdaySupply, highWaterMark, lastDailyDistributionTime, oldestInterest, historicInterests) {
        this.yesterdaySupply = yesterdaySupply;
        this.highWaterMark = highWaterMark;
        this.lastDailyDistributionTime = lastDailyDistributionTime;
        this.oldestInterest = oldestInterest;
        this.historicInterests = [
            ...historicInterests.map((num) => num),
            ...Array(DailyDistributionData.HISTORY_SIZE - historicInterests.length).fill(0),
        ];
    }

    /**
     *
     * @returns {Uint8Array}
     */
    toBytes() {
        return new Uint8Array([
            ...bigintAsU64ToBytes(this.yesterdaySupply),
            ...bigintAsU64ToBytes(this.highWaterMark),
            ...bigintAsU64ToBytes(this.lastDailyDistributionTime),
            ...bigintAsU64ToBytes(this.oldestInterest),
            ...this.historicInterests.flatMap((num) => numAsDouble2LEBytes(num)),
        ]);
    }

    /**
     *
     * @param {Uint8Array} bytes
     * @returns {DailyDistributionData}
     */
    static fromBytes(bytes) {
        let dataView = new DataView(bytes.buffer.slice(bytes.byteOffset));
        return new DailyDistributionData(
            dataView.getBigUint64(0, true),
            dataView.getBigUint64(8, true),
            dataView.getBigInt64(16, true),
            dataView.getBigUint64(24, true),
            LEBytes2DoubleArray(bytes.subarray(32)),
        );
    }
}

export class GlobalDataAccount {
    address;
    owner;
    validBlockhashes;
    dailyDistributionData;

    /**
     *
     * @param {ValidBlockhashes} validBlockhashes
     * @param {DailyDistributionData} dailyDistributionData
     */
    constructor(validBlockhashes, dailyDistributionData) {
        this.address = global_data_account_pubkey;
        this.owner = compto_program_id_pubkey;
        this.validBlockhashes = validBlockhashes;
        this.dailyDistributionData = dailyDistributionData;
    }

    /**
     *
     * @returns {AddedAccount}
     */
    toAccount() {
        return {
            address: this.address,
            info: {
                lamports: BIG_NUMBER,
                data: new Uint8Array([...this.validBlockhashes.toBytes(), ...this.dailyDistributionData.toBytes()]),
                owner: this.owner,
                executable: false,
            },
        };
    }

    /**
     *
     * @param {PublicKey} address unused; for API consistency with other accounts
     * @param {import("solana-bankrun").AccountInfoBytes} accountInfo
     * @returns {GlobalDataAccount}
     */
    static fromAccountInfoBytes(address, accountInfo) {
        return new GlobalDataAccount(
            ValidBlockhashes.fromBytes(accountInfo.data.subarray(0, 80)),
            DailyDistributionData.fromBytes(accountInfo.data.subarray(80)),
        );
    }
}

export class TokenAccount {
    address; //  PublicKey
    lamports; //  u64
    owner; // PublicKey
    mint; //  PublicKey
    nominalOwner; //  PublicKey
    amount; //  u64
    delegate; //  optional PublicKey
    isNative; //  optional u64
    state; //  AccountState
    delegatedAmount; //  u64
    closeAuthority; //  optional PublicKey

    /**
     *
     * @param {PublicKey} address
     * @param {number} lamports
     * @param {PublicKey} mint
     * @param {PublicKey} nominalOwner
     * @param {bigint} amount
     * @param {AccountState} state
     * @param {bigint} delegatedAmount
     * @param {PublicKey | null} delegate
     * @param {bigint | null} isNative if is_some, mint should be native mint, and this stores rent exempt amt
     * @param {PublicKey | null} closeAuthority
     */
    constructor(address, lamports, mint, nominalOwner, amount, state, delegatedAmount, delegate = null, isNative = null, closeAuthority = null) {
        this.address = address;
        this.lamports = lamports;
        this.owner = TOKEN_2022_PROGRAM_ID;
        this.mint = mint;
        this.isNative = toOption(isNative);
        this.nominalOwner = nominalOwner;
        this.amount = amount;
        this.state = state;
        this.delegatedAmount = delegatedAmount;
        this.delegate = toOption(delegate);
        this.closeAuthority = toOption(closeAuthority);
    }

    /**
     *
     * @returns {AddedAccount}
     */
    toAccount() {
        const { option: delegateOption, val: delegate } = getOptionOr(this.delegate, () => PublicKey.default);
        const { option: isNativeOption, val: isNative } = getOptionOr(this.isNative, () => 0n);
        const { option: closeAuthorityOption, val: closeAuthority } = getOptionOr(this.closeAuthority, () => PublicKey.default);

        let buffer = new Uint8Array(ACCOUNT_SIZE);
        AccountLayout.encode(
            {
                mint: this.mint,
                owner: this.nominalOwner,
                amount: this.amount,
                delegateOption: delegateOption,
                delegate: delegate,
                delegatedAmount: this.delegatedAmount,
                state: this.state,
                isNativeOption: isNativeOption,
                isNative: isNative,
                closeAuthorityOption: closeAuthorityOption,
                closeAuthority: closeAuthority,
            },
            buffer,
        );

        return {
            address: this.address,
            info: {
                lamports: this.lamports,
                data: buffer,
                owner: this.owner,
                executable: false,
            },
        };
    }

    /**
     *
     * @param {PublicKey} address
     * @param {AccountInfoBytes} accountInfo
     * @returns {TokenAccount}
     */
    static fromAccountInfoBytes(address, accountInfo) {
        let rawAccount = AccountLayout.decode(accountInfo.data);
        return new TokenAccount(
            address,
            accountInfo.lamports,
            rawAccount.mint,
            rawAccount.owner,
            rawAccount.amount,
            rawAccount.state,
            rawAccount.delegatedAmount,
            rawAccount.delegateOption === 1 ? rawAccount.delegate : null,
            rawAccount.isNativeOption === 1 ? rawAccount.isNative : null,
            rawAccount.closeAuthorityOption === 1 ? rawAccount.closeAuthority : null,
        );
    }
}

export class UserDataAccount {
    address; // PublicKey
    lamports; // u64
    owner; // PublicKey
    lastInterestPayoutDate; // i64
    isVerifiedHuman; // bool
    length; // usize
    recentBlockhash; // Hash
    proofs; // [Hash]

    /**
     *
     * @param {PublicKey} address
     * @param {bigint} lamports
     * @param {bigint} lastInterestPayoutDate
     * @param {boolean} isVerifiedHuman
     * @param {bigint} length
     * @param {Uint8Array} recentBlockhash
     * @param {Uint8Array[]} proofs
     */
    constructor(address, lamports, lastInterestPayoutDate, isVerifiedHuman, length, recentBlockhash, proofs) {
        this.address = address;
        this.lamports = lamports;
        this.owner = compto_program_id_pubkey;
        this.lastInterestPayoutDate = lastInterestPayoutDate;
        this.isVerifiedHuman = isVerifiedHuman;
        this.length = length;
        this.recentBlockhash = recentBlockhash;
        this.proofs = proofs;
    }

    /**
     *
     * @returns {AddedAccount}
     */
    toAccount() {
        let buffer = new Uint8Array([
            ...bigintAsU64ToBytes(this.lastInterestPayoutDate),
            this.isVerifiedHuman ? 1 : 0,
            ...[0, 0, 0, 0, 0, 0, 0], // padding
            ...bigintAsU64ToBytes(this.length),
            ...this.recentBlockhash,
            ...this.proofs.reduce((a, b) => Uint8Array.from([...a, ...b]), new Uint8Array()),
        ]);
        return {
            address: this.address,
            info: {
                lamports: this.lamports,
                data: buffer,
                owner: this.owner,
                executable: false,
            },
        };
    }

    /**
     *
     * @param {PublicKey} address
     * @param {AccountInfoBytes} accountInfo
     * @returns {UserDataAccount}
     */
    static fromAccountInfoBytes(address, accountInfo) {
        const dataView = new DataView(accountInfo.data.buffer);
        return new UserDataAccount(
            address,
            accountInfo.lamports,
            dataView.getBigInt64(0, true),
            dataView.getUint8(8) === 0 ? false : true,
            dataView.getBigUint64(16, true),
            accountInfo.data.subarray(24, 56),
            LEBytes2BlockhashArray(accountInfo.data.subarray(56)),
        );
    }
}

// =============================== Default Account Factories ===============================

/**
 *
 * @returns {MintAccount}
 */
export function get_default_comptoken_mint() {
    return new MintAccount(comptoken_mint_pubkey, BIG_NUMBER, 1n, COMPTOKEN_DECIMALS, global_data_account_pubkey);
}

/**
 *
 * @returns {GlobalDataAccount}
 */
export function get_default_global_data() {
    return new GlobalDataAccount(
        new ValidBlockhashes(
            { blockhash: Uint8Array.from({ length: 32 }, (v, i) => i), time: DEFAULT_ANNOUNCE_TIME },
            { blockhash: Uint8Array.from({ length: 32 }, (v, i) => 2 * i), time: DEFAULT_DISTRIBUTION_TIME }
        ),
        new DailyDistributionData(0n, 0n, DEFAULT_DISTRIBUTION_TIME, 0n, []),
    );
}

/**
 *
 * @param {PublicKey} address
 * @param {PublicKey} owner
 * @returns {TokenAccount}
 */
export function get_default_comptoken_wallet(address, owner) {
    return new TokenAccount(address, BIG_NUMBER, comptoken_mint_pubkey, owner, 0n, AccountState.Initialized, 0n);
}

/**
 *
 * @returns {TokenAccount}
 */
export function get_default_unpaid_interest_bank() {
    return get_default_comptoken_wallet(interest_bank_account_pubkey, global_data_account_pubkey);
}

/**
 *
 * @returns {TokenAccount}
 */
export function get_default_unpaid_ubi_bank() {
    return get_default_comptoken_wallet(ubi_bank_account_pubkey, global_data_account_pubkey);
}

/**
 * 
 * @param {PublicKey} address 
 * @returns {UserDataAccount}
 */
export function get_default_user_data_account(address) {
    return new UserDataAccount(address, BIG_NUMBER, DEFAULT_DISTRIBUTION_TIME, false, 0n, new Uint8Array(32), Array.from({ length: 8 }, (v, i) => new Uint8Array(32)));
}
