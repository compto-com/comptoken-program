import { ACCOUNT_SIZE, AccountLayout, AccountState, ExtraAccountMetaLayout, MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import {
    compto_extra_account_metas_account_pubkey, compto_program_id_pubkey, compto_transfer_hook_id_pubkey, comptoken_mint_pubkey, DEFAULT_ANNOUNCE_TIME,
    DEFAULT_DISTRIBUTION_TIME, global_data_account_pubkey, Instruction, interest_bank_account_pubkey, ubi_bank_account_pubkey,
} from "./common.js";

export const BIG_NUMBER = 1_000_000_000;
export const COMPTOKEN_DECIMALS = 0; // MAGIC NUMBER: remain consistent with comptoken.rs and full_deploy_test.py

// =============================== Helper functions ===============================
/**
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
 * @param {number} num
 * @returns {number[]}
 */
export function numAsU16ToLEBytes(num) {
    let buffer = Buffer.alloc(2);
    buffer.writeUInt16LE(num);
    return Array.from({ length: 2 }, (v, i) => buffer.readUint8(i));
}

/**
 * @param {number} num
 * @returns {number[]}
 */
export function numAsU32ToLEBytes(num) {
    let buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(num);
    return Array.from({ length: 2 }, (v, i) => buffer.readUint8(i));
}

/**
 * @param {number} num
 * @returns {number[]}
 */
export function numAsDoubleToLEBytes(num) {
    let buffer = Buffer.alloc(8);
    buffer.writeDoubleLE(num);
    return Array.from({ length: 8 }, (v, i) => buffer.readUint8(i));
}

/**
 * @template T
 * @param {T[]} bytes
 * @param {number} chunk_size
 * @returns {T[][]}
 */
function chunkArray(bytes, chunk_size) {
    let len = bytes.length / chunk_size;
    let arr = new Array(len);
    for (let i = 0; i < len; ++i) {
        arr[i] = bytes.subarray(i * chunk_size, i * chunk_size + chunk_size);
    }
    return arr;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number[]}
 */
export function LEBytesToDoubleArray(bytes) {
    return chunkArray(bytes, 8).map((elem) => new DataView(elem.buffer.slice(elem.byteOffset)).getFloat64(0, true));
}

/**
 * @param {Uint8Array} bytes 
 * @returns {Uint8Array[]}
 */
export function LEBytesToBlockhashArray(bytes) {
    return chunkArray(bytes, 32);
}

/**
 * @param {Uint8Array} bytes 
 * @returns {ExtraAccountMeta[]}
 */
export function LEBytesToAccountMetaArray(bytes) {
    return chunkArray(bytes, 35).map((elem) => ExtraAccountMeta.fromBytes(elem));
}


/**
 * @template T
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
 * @template T
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
 * @template T
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

class ExtensionType {
    // u16 discriminated type for an extension
    // https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/mod.rs#L1042-L1115
    static Uninitialized = 0;
    static TransferFeeConfig = 1;
    static TransferFeeAmount = 2;
    static MintCloseAuthority = 3
    static ConfidentialTransferMint = 4;
    static ConfidentialTransferAccount = 5;
    static DefaultAccountState = 6;
    static ImmutableOwner = 7;
    static MemoTransfer = 8;
    static NonTransferable = 9;
    static InterestBearingConfig = 10;
    static CpiGuard = 11;
    static PermanentDelegate = 12;
    static NonTransferableAccount = 13;
    static TransferHook = 14;
    static TransferHookAccount = 15;
    static MetadataPointer = 18;
    static TokenMetadata = 19;
    static GroupPointer = 20;
    static TokenGroup = 21;
    static GroupMemberPointer = 22;
    static TokenGroupMember = 23;
}

export class TLV {
    // structure derived from
    // https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/mod.rs#L106-L114
    type; // u16
    length; // u16
    value; // [u8; length]

    /**
     * @param {number} type
     * @param {number} length
     * @param {Uint8Array} value
     */
    constructor(type, length, value) {
        this.type = type;
        this.length = length;
        this.value = value;
    }

    static Uninitialized() {
        return new TLV(ExtensionType.Uninitialized, 0, new Uint8Array(0));
    }

    /**
     * @param {PublicKey} programId
     * @param {PublicKey | null} authority
     * @returns {TLV}
     */
    static transferHook(programId, authority = null) {
        authority = getOptionOr(toOption(authority), () => PublicKey.default).val;
        let value = Uint8Array.from([...authority.toBytes(), ...programId.toBytes()]);
        return new TLV(ExtensionType.TransferHook, 64, value);
    }

    /**
     * @returns {TLV}
     */
    static TransferHookAccount() {
        let value = new Uint8Array(1);
        return new TLV(ExtensionType.TransferHookAccount, 1, value);
    }

    /**
     * @returns {Uint8Array}
     */
    toBytes() {
        let bytes = Uint8Array.from([...numAsU16ToLEBytes(this.type), ...numAsU16ToLEBytes(this.length), ...this.value]);
        return bytes;
    }

    /**
     * @param {Uint8Array} bytes 
     * @returns {TLV}
     */
    static fromBytes(bytes) {
        let buffer = new DataView(bytes.buffer.slice(bytes.byteOffset));
        return new TLV(buffer.getUint16(0, true), buffer.getUint16(2, true), bytes.subarray(4, 4 + buffer.getUint16(2, true)));
    }
}

class AccountWithExtensions {
    extensions; // [TLV]
    static extensions_start_index = 165; // comes from https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/mod.rs#L273-L291
    constructor() {
        this.extensions = [];
    }

    /**
     * @param {TLV} tlv
     * @returns {MintAccount}
     */
    addExtension(tlv) {
        this.extensions.push(tlv);
        return this;
    }

    /**
     * @returns {number}
     */
    getSize() {
        if (this.extensions.length === 0) {
            return this.constructor.SIZE;
        }
        let size = this.extensions.reduce((pv, cv, i) => pv + cv.length + 4, 166);
        // solana code says they pad with uninitialized ExtensionType if size is 355
        // https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/mod.rs#L1047-L1049
        if (size == 355) {
            return size + 4;
        }
        return size;
    }

    /**
     * @param {Uint8Array} buffer
     */
    encodeExtensions(buffer) {
        let index = AccountWithExtensions.extensions_start_index;
        buffer[index++] = this.constructor.ACCOUNT_TYPE;
        for (let extension of this.extensions) {
            let bytes = extension.toBytes();
            buffer.set(bytes, index);
            index += bytes.length;
        }
    }

    /**
     * @param {Uint8Array} buffer 
     */
    static decodeExtensions(buffer) {
        let index = AccountWithExtensions.extensions_start_index;
        if (buffer[index++] !== this.ACCOUNT_TYPE) {
            throw Error("invalid account type");
        }
        let extensions = [];
        while (index + 4 < buffer.length) {
            let extension = TLV.fromBytes(buffer.subarray(index));
            extensions.push(extension);
            index += extension.length + 4;
        }
        return extensions;
    }
}

export class MintAccount extends AccountWithExtensions {
    address; //  PublicKey
    lamports; //  u64
    owner; // PublicKey

    supply; //  u64
    decimals; //  u8
    mintAuthority; //  optional PublicKey
    freezeAuthority; //  optional PublicKey

    static SIZE = MINT_SIZE;
    static ACCOUNT_TYPE = 1;

    /**
     * @param {PublicKey} address
     * @param {number} lamports
     * @param {bigint} supply
     * @param {number} decimals
     * @param {PublicKey | null} mintAuthority
     * @param {PublicKey | null} freezeAuthority
     */
    constructor(address, lamports, supply, decimals, mintAuthority = null, freezeAuthority = null) {
        super()
        this.address = address;
        this.lamports = lamports;
        this.owner = TOKEN_2022_PROGRAM_ID
        this.supply = supply;
        this.decimals = decimals;
        this.mintAuthority = toOption(mintAuthority);
        this.freezeAuthority = toOption(freezeAuthority);
    }

    /**
     * @returns {AddedAccount}
     */
    toAccount() {
        const { option: freezeAuthorityOption, val: freezeAuthority } = getOptionOr(this.freezeAuthority, () => PublicKey.default);
        const { option: mintAuthorityOption, val: mintAuthority } = getOptionOr(this.mintAuthority, () => PublicKey.default);

        let buffer = new Uint8Array(this.getSize());
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

        this.encodeExtensions(buffer);

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
     * @param {PublicKey} address
     * @param {AccountInfoBytes} accountInfo
     * @returns {MintAccount}
     */
    static fromAccountInfoBytes(address, accountInfo) {
        let rawMint = MintLayout.decode(accountInfo.data);
        let mintAccount = new MintAccount(
            address,
            accountInfo.lamports,
            rawMint.supply,
            rawMint.decimals,
            rawMint.mintAuthorityOption === 1 ? rawMint.mintAuthority : null,
            rawMint.freezeAuthorityOption === 1 ? rawMint.freezeAuthority : null,
        );
        mintAccount.extensions = this.decodeExtensions(accountInfo.data);
        return mintAccount;
    }
}
export class ValidBlockhashes {
    announcedBlockhash; //  blockhash
    announcedBlockhashTime; //  i64
    validBlockhash; //  blockhash
    validBlockhashTime; //  i64

    /**
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
     * @returns {Uint8Array}
     */
    toBytes() {
        return new Uint8Array([
            ...bigintAsU64ToBytes(this.yesterdaySupply),
            ...bigintAsU64ToBytes(this.highWaterMark),
            ...bigintAsU64ToBytes(this.lastDailyDistributionTime),
            ...bigintAsU64ToBytes(this.oldestInterest),
            ...this.historicInterests.flatMap((num) => numAsDoubleToLEBytes(num)),
        ]);
    }

    /**
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
            LEBytesToDoubleArray(bytes.subarray(32)),
        );
    }
}

export class GlobalDataAccount {
    address;
    owner;
    validBlockhashes;
    dailyDistributionData;

    /**
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

export class TokenAccount extends AccountWithExtensions {
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

    static SIZE = ACCOUNT_SIZE;
    static ACCOUNT_TYPE = 2;

    /**
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
        super()
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
     * @returns {AddedAccount}
     */
    toAccount() {
        const { option: delegateOption, val: delegate } = getOptionOr(this.delegate, () => PublicKey.default);
        const { option: isNativeOption, val: isNative } = getOptionOr(this.isNative, () => 0n);
        const { option: closeAuthorityOption, val: closeAuthority } = getOptionOr(this.closeAuthority, () => PublicKey.default);

        let buffer = new Uint8Array(this.getSize());
        AccountLayout.encode(
            {
                mint: this.mint,
                owner: this.nominalOwner,
                amount: BigInt(this.amount),
                delegateOption: delegateOption,
                delegate: delegate,
                delegatedAmount: BigInt(this.delegatedAmount),
                state: this.state,
                isNativeOption: isNativeOption,
                isNative: BigInt(isNative),
                closeAuthorityOption: closeAuthorityOption,
                closeAuthority: closeAuthority,
            },
            buffer,
        );

        this.encodeExtensions(buffer);

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
     * @param {PublicKey} address
     * @param {AccountInfoBytes} accountInfo
     * @returns {TokenAccount}
     */
    static fromAccountInfoBytes(address, accountInfo) {
        let rawAccount = AccountLayout.decode(accountInfo.data);
        let tokenAccount = new TokenAccount(
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
        tokenAccount.extensions = TokenAccount.decodeExtensions(accountInfo.data);
        return tokenAccount;
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
            LEBytesToBlockhashArray(accountInfo.data.subarray(56)),
        );
    }
}

export class Seed {
    discriminator; // u8
    data; // [u8]

    static Types = {
        NULL: 0,
        LITERAL: 1, // corresponds to a data of [u8]
        INSTRUCTION_ARG: 2,
        ACCOUNT_KEY: 3, // corresponds to a data of u8 (refernces )
        ACCOUNT_DATA: 4,
    }

    constructor(discriminator, data) {
        if (discriminator !== Seed.Types.ACCOUNT_KEY) {
            throw Error("not implemented");
        }
        this.discriminator = discriminator;
        this.data = [data];
    }

    toBytes() {
        if (this.discriminator !== Seed.Types.ACCOUNT_KEY) {
            throw Error("not implemented");
        }
        return Uint8Array.from([this.discriminator, ...this.data])
    }
}

export class AddressConfig {
    type;
    configData; //

    static Types = {
        LITERAL: 0,
        PDA_TRANSFER_HOOK_PROGRAM: 1,
        PDA_OTHER_PROGRAM: 0b1000_0000,
    }

    /**
     * @param {number} type 
     * @param {PublicKey | Seed[]} configData 
     */
    constructor(type, configData, other = -1) {
        if (type === AddressConfig.Types.PDA_OTHER_PROGRAM) {
            this.type = type | other;
        } else {
            this.type = type;
        }

        if (type === AddressConfig.Types.LITERAL) {
            // data is pubkey
            this.configData = configData.toBytes();
            return;
        }
        // data is Seeds[]
        let data = new Uint8Array(32);
        data.set(configData.flatMap((seed, i) => Array.from(seed.toBytes())), 0);
        this.configData = data;
    }
}

// effectively implements ExtraAccountMeta interface from
// @solana/spl-token/src/extensions/transferHook/state.ts
export class ExtraAccountMeta {
    discriminator; // u8
    addressConfig; // [u8; 32]
    isSigner; // bool
    isWritable; // bool

    /**
     * @param {AddressConfig} addressConfig 
     * @param {boolean} isSigner 
     * @param {boolean} isWritable 
     */
    constructor(addressConfig, isSigner, isWritable) {
        this.isSigner = isSigner;
        this.isWritable = isWritable;
        this.addressConfig = addressConfig.configData;
        this.discriminator = addressConfig.type;
    }

    static SIZE = 35;

    /**
     * @returns {Uint8Array}
     */
    toBytes() {
        let buffer = new Uint8Array(35);
        ExtraAccountMetaLayout.encode(this, buffer);
        return buffer;
    }

    /**
     * @param {Uint8Array} bytes 
     * @returns {ExtraAccountMeta}
     */
    static fromBytes(bytes) {
        let data = ExtraAccountMetaLayout.decode(bytes);
        let extraAccountMeta = new ExtraAccountMeta(
            new AddressConfig(0, PublicKey.default),
            data.isSigner,
            data.isWritable,
        );
        extraAccountMeta.addressConfig = data.addressConfig;
        extraAccountMeta.discriminator = data.discriminator;
        return extraAccountMeta;
    }
}

export class ExtraAccountMetaAccount {
    address; //  PublicKey
    lamports; //  u64
    owner; // PublicKey

    extraAccountMetas; // [accountMeta]

    /**
     * @param {PublicKey} address 
     * @param {number} lamports 
     * @param {PublicKey} owner 
     * @param {ExtraAccountMeta[]} extraAccountMetas 
     */
    constructor(address, lamports, owner, extraAccountMetas) {
        this.address = address;
        this.lamports = lamports;
        this.owner = owner;
        this.extraAccountMetas = extraAccountMetas;
    }

    /**
     * @returns {AddedAccount}
     */
    toAccount() {
        let extraAccountMetasSize = 4 + ExtraAccountMeta.SIZE * this.extraAccountMetas.length;
        let buffer = new Uint8Array(12 + extraAccountMetasSize);
        // value is solanas transfer hook execute instruction discriminator
        // https://github.com/solana-labs/solana-program-library/blob/token-2022-v3.0/token/js/src/extensions/transferHook/instructions.ts#L168
        buffer.set(Uint8Array.from([105, 37, 101, 197, 75, 251, 102, 26]), 0);
        buffer.set(numAsU32ToLEBytes(extraAccountMetasSize), 8);
        buffer.set(numAsU32ToLEBytes(this.extraAccountMetas.length), 12);
        let i = 16;
        for (let accountMeta of this.extraAccountMetas) {
            buffer.set(accountMeta.toBytes(), i);
            i += ExtraAccountMeta.SIZE;
        }

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
     * @param {PublicKey} address
     * @param {import("solana-bankrun").AccountInfoBytes} accountInfo
     * @returns {ExtraAccountMetaAccount}
     */
    static fromAccountInfoBytes(address, accountInfo) {
        return new ExtraAccountMetaAccount(
            address,
            accountInfo.lamports,
            accountInfo.owner,
            LEBytesToAccountMetaArray(accountInfo.data.subarray(16)),
        );
    }
}

// =============================== Default Account Factories ===============================

/**
 * @returns {MintAccount}
 */
export function get_default_comptoken_mint() {
    return new MintAccount(comptoken_mint_pubkey, BIG_NUMBER, 1n, COMPTOKEN_DECIMALS, global_data_account_pubkey)
        .addExtension(TLV.transferHook(compto_transfer_hook_id_pubkey));
}

/**
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
 * @param {PublicKey} address
 * @param {PublicKey} owner
 * @returns {TokenAccount}
 */
export function get_default_comptoken_wallet(address, owner) {
    return new TokenAccount(address, BIG_NUMBER, comptoken_mint_pubkey, owner, 0n, AccountState.Initialized, 0n)
        .addExtension(TLV.TransferHookAccount());
}

/**
 * @returns {TokenAccount}
 */
export function get_default_unpaid_interest_bank() {
    return get_default_comptoken_wallet(interest_bank_account_pubkey, global_data_account_pubkey);
}

/**
 * @returns {TokenAccount}
 */
export function get_default_unpaid_ubi_bank() {
    return get_default_comptoken_wallet(ubi_bank_account_pubkey, global_data_account_pubkey);
}

/**
 * @param {PublicKey} address 
 * @returns {UserDataAccount}
 */
export function get_default_user_data_account(address) {
    return new UserDataAccount(address, BIG_NUMBER, DEFAULT_DISTRIBUTION_TIME, false, 0n, new Uint8Array(32), Array.from({ length: 8 }, (v, i) => new Uint8Array(32)));
}

/**
 * @returns {ExtraAccountMetaAccount}
 */
export function get_default_extra_account_metas_account() {
    return new ExtraAccountMetaAccount(compto_extra_account_metas_account_pubkey, BIG_NUMBER, compto_transfer_hook_id_pubkey, [
        new ExtraAccountMeta(new AddressConfig(AddressConfig.Types.LITERAL, compto_program_id_pubkey), false, false),
        // 0 refers to senders account, 5 refers to compto program
        new ExtraAccountMeta(new AddressConfig(AddressConfig.Types.PDA_OTHER_PROGRAM, [new Seed(Seed.Types.ACCOUNT_KEY, 0)], 5), false, false),
        // 2 refers to recievers account, 5 refers to compto program
        new ExtraAccountMeta(new AddressConfig(AddressConfig.Types.PDA_OTHER_PROGRAM, [new Seed(Seed.Types.ACCOUNT_KEY, 2)], 5), false, false),
    ]);
}