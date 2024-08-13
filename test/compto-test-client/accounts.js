import { blob, f64, greedy, seq, struct } from "@solana/buffer-layout";
import { bool, u64 } from "@solana/buffer-layout-utils";
import {
    ACCOUNT_SIZE,
    AccountLayout,
    AccountState,
    ExtraAccountMetaAccountDataLayout,
    ExtraAccountMetaLayout,
    MINT_SIZE,
    MintLayout,
    TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import {
    BIG_NUMBER,
    compto_extra_account_metas_account_pubkey,
    compto_program_id_pubkey,
    compto_transfer_hook_id_pubkey,
    COMPTOKEN_DECIMALS,
    comptoken_mint_pubkey,
    DEFAULT_ANNOUNCE_TIME,
    DEFAULT_DISTRIBUTION_TIME,
    global_data_account_pubkey,
    interest_bank_account_pubkey,
    ubi_bank_account_pubkey,
} from "./common.js";
import { getOptionOr, numAsU16ToLEBytes, toOption } from "./utils.js";

export const COMPTOKEN_WALLET_SIZE = 256; // TODO: get actual value


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
    static TransferHook(programId, authority = null) {
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

export class DataType {
    constructor(rawType) {
        // copy the properties from rawType to this
        for (const field in rawType) {
            this[field] = rawType[field];
        }
    }

    getSize() {
        return this.constructor.LAYOUT.span;
    }

    static fromBytes(bytes) {
        return new DataType(this.LAYOUT.decode(bytes));
    }

    toBytes() {
        let bytes = new Uint8Array(this.getSize());
        this.constructor.LAYOUT.encode(this, bytes);
        return bytes;
    }
}

export class DataTypeWithExtensions extends DataType {
    extensions;

    static EXTENSIONS_START_INDEX = 165; // comes from https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/mod.rs#L273-L291

    constructor(rawType) {
        super(rawType);
        this.extensions = [];
    }

    encodeExtensions(buffer) {
        let index = DataTypeWithExtensions.EXTENSIONS_START_INDEX;
        buffer[index++] = this.constructor.ACCOUNT_TYPE;
        for (let extension of this.extensions) {
            let bytes = extension.toBytes();
            buffer.set(bytes, index);
            index += bytes.length;
        }
    }

    static decodeExtensions(buffer) {
        let index = DataTypeWithExtensions.EXTENSIONS_START_INDEX;
        if (buffer[index++] !== this.ACCOUNT_TYPE) {
            throw Error("Incorrect Account Type: type is " + buffer[index - 1] + " but should be " + this.ACCOUNT_TYPE);
        }
        let extensions = [];
        while (index + 4 < buffer.length) {
            let extension = TLV.fromBytes(buffer.subarray(index));
            extensions.push(extension);
            index += extension.length + 4;
        }
        return extensions;
    }

    addExtensions(...extensions) {
        for (let ext of extensions) {
            this.extensions.push(ext);
        }
        return this;
    }

    getSize() {
        if (this.extensions.length === 0) {
            return this.constructor.SIZE;
        }
        let size = this.extensions.reduce(
            (sum, extension, i) => sum + extension.length + 4,
            166
        );
        if (size == 355) {
            // solana code says they pad with uninitialized ExtensionType if size is 355
            // https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/mod.rs#L1047-L1049
            return size + 4;
        }
        return size;
    }

    static fromBytes(bytes) {
        let extensions = this.decodeExtensions(bytes);
        return new DataTypeWithExtensions(super.fromBytes(bytes)).addExtensions(
            ...extensions
        );
    }

    toBytes() {
        let buffer = new Uint8Array(this.getSize());
        buffer.set(super.toBytes(), 0);
        if (this.extensions.length > 0) {
            this.encodeExtensions(buffer);
        }
        return buffer;
    }
}

export class Account {
    address;
    lamports;
    owner;
    data;

    constructor(address, lamports, owner, data) {
        this.address = address;
        this.lamports = lamports;
        this.owner = owner;
        this.data = data;
    }

    toAddedAccount() {
        return {
            address: this.address,
            info: {
                lamports: this.lamports,
                data: this.data.toBytes(),
                owner: this.owner,
                executable: false,
            },
        };
    }

    toAccount = this.toAddedAccount;

    static fromAccountInfoBytes(address, accountInfo) {
        let data = this.DATA_TYPE.fromBytes(accountInfo.data);
        return new Account(
            address,
            accountInfo.lamports,
            accountInfo.owner,
            data
        );
    }
}

export class Mint extends DataTypeWithExtensions {
    static LAYOUT = MintLayout;
    static SIZE = MINT_SIZE;
    static ACCOUNT_TYPE = 1;

    mintAuthorityOption_; // u32
    mintAuthority_; // PublicKey;
    supply_; // u64
    decimals_; // u64
    isInitialized_; // bool
    freezeAuthorityOption_; // u32
    freezeAuthority_; // PublicKey
}

export class MintAccount extends Account {
    static DATA_TYPE = Mint;
}

export class Token extends DataTypeWithExtensions {
    static LAYOUT = AccountLayout;
    static SIZE = ACCOUNT_SIZE;
    static ACCOUNT_TYPE = 2;

    mint_; //  PublicKey
    nominalOwner_; //  PublicKey
    amount_; //  u64
    delegate_; //  optional PublicKey
    isNative_; //  optional u64
    state_; //  AccountState
    delegatedAmount_; //  u64
    closeAuthority_; //  optional PublicKey
}

export class TokenAccount extends Account {
    static DATA_TYPE = Token;
}

export class ExtraAccountMetaAccountData extends DataType {
    static LAYOUT = ExtraAccountMetaAccountDataLayout;

    getSize() {
        return 12 + this.length;
    }

    toBytes() {
        this.extraAccountsList.count = this.extraAccountsList.extraAccounts.length;
        this.length = 4 + this.extraAccountsList.count * ExtraAccountMetaLayout.span;
        return super.toBytes();
    }

    instructionDiscriminator_;
    length_;
    extraAccountsList_; // { count: number, extraAccounts: ExtraAccountMeta[] }
}

export class ExtraAccountMetaAccount extends Account {
    static DATA_TYPE = ExtraAccountMetaAccountData;
}

export const UserDataLayout = struct([
    u64("lastInterestPayoutDate"), // actually an i64 but will always be positive
    bool("isVerifiedHuman"),
    blob(7), // padding
    u64("length"),
    blob(32, "recentBlockhash"),
    seq(blob(32), greedy(32), "proofs"),
]);

export class UserData extends DataType {
    static LAYOUT = UserDataLayout;

    static MIN_SIZE = 88; // MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN user_data.rs

    lastInterestPayoutDate_; // i64
    isVerifiedHuman_; // bool
    length_; // usize
    recentBlockhash_; // Hash
    proofs_; // [Hash]

    getSize() {
        return this.constructor.MIN_SIZE + 32 * (this.proofs.length - 1);
    }
}

export class UserDataAccount extends Account {
    static DATA_TYPE = UserData;
}

export class GlobalData extends DataType {
    // LAYOUT defined later to avoid circular dependency

    validBlockhashes_;
    dailyDistributionData_;

    static DAILY_DISTRIBUTION_HISTORY_SIZE = 365; // MAGIC NUMBER: remain consistent with rust
}

export const ValidBlockhashesLayout = struct([
    blob(32, "announcedBlockhash"),
    u64("announcedBlockhashTime"), // actually i64, but will always be positive
    blob(32, "validBlockhash"),
    u64("validBlockhashTime"), // actually i64, but will always be positive
]);

export const DailyDistributionDataLayout = struct([
    u64("yesterdaySupply"),
    u64("highWaterMark"),
    u64("lastDailyDistributionTime"), // actually i64, but will always be positive
    u64("oldestInterest"),
    seq(f64(), GlobalData.DAILY_DISTRIBUTION_HISTORY_SIZE, "historicInterests"),
]);

export const GlobalDataLayout = struct([
    ValidBlockhashesLayout.replicate("validBlockhashes"),
    DailyDistributionDataLayout.replicate("dailyDistributionData"),
])

GlobalData.LAYOUT = GlobalDataLayout; // GlobalDataLayout uses DailyDistributionData, which uses GlobalData's DAILY_DISTRIBUTION_HISTORY_SIZE

export class GlobalDataAccount extends Account {
    static DATA_TYPE = GlobalData;
}

export class Seed {
    discriminator; // u8
    data; // [u8]

    static Types = {
        NULL: 0,
        LITERAL: 1, // corresponds to a data of [u8]
        INSTRUCTION_ARG: 2,
        ACCOUNT_KEY: 3, // corresponds to a data of u8 (is an index into the extraAccountMetas list)
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

function seedsToAddressConfig(seeds) {
    let data = new Uint8Array(32);
    data.set(seeds.flatMap((seed, i) => Array.from(seed.toBytes())), 0);
    return data;
}

export class ExtraAccountMeta extends DataType {
    static LAYOUT = ExtraAccountMetaLayout;

    discriminator_; // u8
    addressConfig_; // [u8; 32]
    isSigner_; // bool
    isWritable_; // bool
}

// ======================================== Default Constructors ========================================

/**
 * @returns {MintAccount}
 */
export function get_default_comptoken_mint() {
    return new MintAccount(comptoken_mint_pubkey, BIG_NUMBER, TOKEN_2022_PROGRAM_ID, new Mint({
        mintAuthorityOption: 1,
        mintAuthority: global_data_account_pubkey,
        supply: 0n,
        decimals: COMPTOKEN_DECIMALS,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
    }).addExtensions(TLV.TransferHook(compto_transfer_hook_id_pubkey)));
}

/**
 * @returns {GlobalDataAccount}
 */
export function get_default_global_data() {
    return new GlobalDataAccount(global_data_account_pubkey, BIG_NUMBER, compto_program_id_pubkey,
        new GlobalData({
            validBlockhashes: {
                announcedBlockhash: Uint8Array.from({ length: 32 }, (v, i) => i),
                announcedBlockhashTime: DEFAULT_ANNOUNCE_TIME,
                validBlockhash: Uint8Array.from({ length: 32 }, (v, i) => 2 * i),
                validBlockhashTime: DEFAULT_DISTRIBUTION_TIME,
            },
            dailyDistributionData: {
                yesterdaySupply: 0n,
                highWaterMark: 0n,
                lastDailyDistributionTime: DEFAULT_DISTRIBUTION_TIME,
                oldestInterest: 0n,
                historicInterests: Array.from({ length: GlobalData.DAILY_DISTRIBUTION_HISTORY_SIZE }, (v, i) => new Uint8Array(32)),
            },
        }));
}

/**
 * @param {PublicKey} address
 * @param {PublicKey} owner
 * @returns {TokenAccount}
 */
export function get_default_comptoken_wallet(address, owner) {
    return new TokenAccount(address, BIG_NUMBER, TOKEN_2022_PROGRAM_ID,
        new Token({
            mint: comptoken_mint_pubkey,
            owner,
            amount: 0n,
            delegateOption: 0,
            delegate: PublicKey.default,
            state: AccountState.Initialized,
            isNativeOption: 0,
            isNative: 0n,
            delegatedAmount: 0n,
            closeAuthorityOption: 0,
            closeAuthority: PublicKey.default,
        }).addExtensions(TLV.TransferHookAccount()));
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
 * @param {PublicKey} owner 
 * @returns {TokenAccount}
 */
//export function get_default_testuser_comptoken_wallet(owner) {
//    return get_default_comptoken_wallet(testuser_comptoken_wallet_pubkey, owner);
//}

/**
 * @param {PublicKey} address 
 * @returns {UserDataAccount}
 */
export function get_default_user_data_account(address) {
    return new UserDataAccount(address, BIG_NUMBER, compto_program_id_pubkey,
        new UserData({
            lastInterestPayoutDate: DEFAULT_DISTRIBUTION_TIME,
            isVerifiedHuman: false,
            length: 0n,
            recentBlockhash: new Uint8Array(32),
            proofs: Array.from({ length: 8 }, (v, i) => new Uint8Array(32))
        }));
}

/**
 * @returns {ExtraAccountMetaAccount}
 */
export function get_default_extra_account_metas_account() {
    let extraAccountsMetaList = [
        new ExtraAccountMeta({
            discriminator: 0, // Literal
            addressConfig: compto_program_id_pubkey.toBytes(),
            isSigner: false,
            isWritable: false,
        }),
        new ExtraAccountMeta({
            discriminator: 0b1000_0000 | 5, // PDA from other program at index 5
            addressConfig: seedsToAddressConfig([new Seed(Seed.Types.ACCOUNT_KEY, 0)]), // 1 seed, pubkey of account at index 0 (source)
            isSigner: false,
            isWritable: false,
        }),
        new ExtraAccountMeta({
            discriminator: 0b1000_0000 | 5, // PDA from other program at index 5
            addressConfig: seedsToAddressConfig([new Seed(Seed.Types.ACCOUNT_KEY, 2)]), // 1 seed, pubkey of account at index 2 (destination)
            isSigner: false,
            isWritable: false,
        }),
    ];
    let acct = new ExtraAccountMetaAccount(compto_extra_account_metas_account_pubkey, BIG_NUMBER, compto_transfer_hook_id_pubkey,
        new ExtraAccountMetaAccountData({
            // value is solanas transfer hook execute instruction discriminator
            // https://github.com/solana-labs/solana-program-library/blob/token-2022-v3.0/token/js/src/extensions/transferHook/instructions.ts#L168
            instructionDiscriminator: Buffer.from([105, 37, 101, 197, 75, 251, 102, 26]).readBigUInt64LE(0),
            length: 16 + extraAccountsMetaList.length * ExtraAccountMetaLayout.span,
            extraAccountsList: { count: extraAccountsMetaList.length, extraAccounts: extraAccountsMetaList, },
        }));
    return acct;
}