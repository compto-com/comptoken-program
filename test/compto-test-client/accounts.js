import {
    COMPTOKEN_DECIMALS,
    GlobalData,
    GlobalDataAccount,
    TLV,
    Token,
    TokenAccount,
    UserData,
    UserDataAccount,
} from "@compto/comptoken.js";
import {
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
    compto_public_keys,
    DEFAULT_ANNOUNCE_TIME,
    DEFAULT_DISTRIBUTION_TIME,
} from "./common.js";

/**
 * @import { AccountInfo } from "@solana/web3.js";
 * @import {
 *      RawMint,
 *      ExtraAccountMetaAccountData as EAMAD,
 *      ExtraAccountMeta as EAM,
 * } from "@solana/spl-token";
 * 
 * @import {
 *      Account,
 *      AccountStatic,
 *      DataType,
 *      DataTypeStatic,
 *      DataTypeWithExtensions,
 *      DataTypeWithExtensionsStatic,
 * } from "@compto/comptoken.js/lib/accounts.js";
 */

/**
 * @implements {DataTypeWithExtensions<RawMint>}
 */
export class Mint {
    static LAYOUT = MintLayout;
    static SIZE = MINT_SIZE;
    static ACCOUNT_TYPE = 1;
    /** @readonly */
    static EXTENSIONS_START_INDEX = 165;

    /**
     * @param {object} params 
     * @param {0 | 1} params.mintAuthorityOption
     * @param {PublicKey} params.mintAuthority
     * @param {bigint} params.supply
     * @param {number} params.decimals
     * @param {boolean} params.isInitialized
     * @param {0 | 1} params.freezeAuthorityOption
     * @param {PublicKey} params.freezeAuthority
     */
    constructor({
        mintAuthorityOption,
        mintAuthority,
        supply,
        decimals,
        isInitialized,
        freezeAuthorityOption,
        freezeAuthority
    }) {
        this.mintAuthorityOption = mintAuthorityOption;
        this.mintAuthority = mintAuthority;
        this.supply = supply;
        this.decimals = decimals;
        this.isInitialized = isInitialized;
        this.freezeAuthorityOption = freezeAuthorityOption;
        this.freezeAuthority = freezeAuthority;
        /** @type {TLV[]} */ this.extensions = [];
    }
    get data() {
        return this;
    };

    getSize() {
        if (this.extensions.length === 0) {
            return Mint.SIZE;
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
    };

    toBytes() {
        let buffer = new Uint8Array(this.getSize());
        Mint.LAYOUT.encode(this.data, buffer);
        if (this.extensions.length > 0) {
            this.encodeExtensions(buffer);
        }
        return buffer;
    };

    /**
     * @param {Uint8Array} buffer
     */
    static fromBytes(buffer) {
        let extensions = Mint.decodeExtensions(buffer);
        return new Mint(Mint.LAYOUT.decode(buffer))
            .addExtensions(...extensions);
    }

    /**
     * @param {Uint8Array} buffer
     */
    encodeExtensions(buffer) {
        let index = Mint.EXTENSIONS_START_INDEX;
        buffer[index++] = Mint.ACCOUNT_TYPE;
        for (let extension of this.extensions) {
            let bytes = extension.toBytes();
            buffer.set(bytes, index);
            index += bytes.length;
        }
    };

    /**
     * @param {Uint8Array} buffer
     */
    static decodeExtensions(buffer) {
        let index = Mint.EXTENSIONS_START_INDEX;
        if (buffer[index++] !== Mint.ACCOUNT_TYPE) {
            throw Error("Incorrect Account Type: type is " + buffer[index - 1] + " but should be " + Mint.ACCOUNT_TYPE);
        }
        let extensions = [];
        while (index + 4 < buffer.length) {
            let extension = TLV.fromBytes(buffer.subarray(index));
            extensions.push(extension);
            index += extension.length + 4;
        }
        return extensions;
    }

    /**
     * @param {...TLV} extensions
     */
    addExtensions(...extensions) {
        for (let ext of extensions) {
            this.extensions.push(ext);
        }
        return this;
    };
}
/** @type {DataTypeWithExtensionsStatic<RawMint>} */ const _MintStatic = Mint;

/**
 * @implements {Account<RawMint>}
 */
export class MintAccount {
    static DATA_TYPE = Mint;

    get data() { return this._data.data; }

    /**
     * @param {PublicKey}         address
     * @param {number}            lamports
     * @param {PublicKey}         owner
     * @param {DataType<RawMint>} data
     */
    constructor(address, lamports, owner, data) {
        this.address = address;
        this.lamports = lamports;
        this.owner = owner;
        this._data = data;
    }

    toAddedAccount() {
        return {
            address: this.address,
            info: {
                lamports: this.lamports,
                data: this._data.toBytes(),
                owner: this.owner,
                executable: false,
            },
        };
    }
    toAccount = this.toAddedAccount;

    /**
     * @param {PublicKey} address 
     * @param {AccountInfo<Uint8Array>} accountInfo 
     * @returns 
     */
    static fromAccountInfoBytes(address, accountInfo) {
        let data = MintAccount.DATA_TYPE.fromBytes(accountInfo.data);
        return new MintAccount(
            address,
            accountInfo.lamports,
            accountInfo.owner,
            data
        );
    }
}
/** @type {AccountStatic<RawMint>} */ const _MintAccountStatic = MintAccount;

/**
 * @implements {DataType<EAMAD>}
 */
export class ExtraAccountMetaAccountData {
    static LAYOUT = ExtraAccountMetaAccountDataLayout;

    /**
     * @param {object} params
     * @param {bigint} params.instructionDiscriminator
     * @param {number} params.length
     * @param {object} params.extraAccountsList
     * @param {number} params.extraAccountsList.count
     * @param {EAM[]}  params.extraAccountsList.extraAccounts
     */
    constructor({ instructionDiscriminator, length, extraAccountsList }) {
        this.instructionDiscriminator = instructionDiscriminator;
        this.length = length;
        this.extraAccountsList = extraAccountsList;
    }

    get data() {
        return this;
    }

    getSize() {
        return 12 + this.length;
    }

    toBytes() {
        this.extraAccountsList.count = this.extraAccountsList.extraAccounts.length;
        this.length = 4 + this.extraAccountsList.count * ExtraAccountMetaLayout.span;
        let buffer = new Uint8Array(this.getSize());
        ExtraAccountMetaAccountData.LAYOUT.encode(this.data, buffer);
        return buffer;
    }

    /**
     * @param {Uint8Array} buffer
     */
    static fromBytes(buffer) {
        let data = ExtraAccountMetaAccountData.LAYOUT.decode(buffer);
        return new ExtraAccountMetaAccountData(data);
    }
}
/** @type {DataTypeStatic<EAMAD>} */ const _ExtraAccountMetaAccountDataStatic = ExtraAccountMetaAccountData;

/**
 * @implements {Account<EAMAD>}
 */
export class ExtraAccountMetaAccount {
    static DATA_TYPE = ExtraAccountMetaAccountData;

    get data() { return this._data.data; }

    /**
     * @param {PublicKey} address 
     * @param {number} lamports 
     * @param {PublicKey} owner 
     * @param {DataType<EAMAD>} data 
     */
    constructor(address, lamports, owner, data) {
        this.address = address;
        this.lamports = lamports;
        this.owner = owner;
        this._data = data;
    }

    toAddedAccount() {
        return {
            address: this.address,
            info: {
                lamports: this.lamports,
                data: this._data.toBytes(),
                owner: this.owner,
                executable: false,
            },
        };
    }
    toAccount = this.toAddedAccount;

    /**
     * @param {PublicKey} address 
     * @param {AccountInfo<Uint8Array>} accountInfo 
     */
    static fromAccountInfoBytes(address, accountInfo) {
        let data = ExtraAccountMetaAccount.DATA_TYPE.fromBytes(accountInfo.data);
        return new ExtraAccountMetaAccount(
            address,
            accountInfo.lamports,
            accountInfo.owner,
            data
        );
    }
}
/** @type {AccountStatic<EAMAD>} */ const _ExtraAccountMetaAccountStatic = ExtraAccountMetaAccount;

class Seed {
    discriminator; // u8
    data; // [u8]

    /** 
     * @enum {0 | 1 | 2 | 3 | 4}
     */
    static Types = /** @type {const} */ ({
        NULL: 0,
        LITERAL: 1, // corresponds to a data of [u8]
        INSTRUCTION_ARG: 2,
        ACCOUNT_KEY: 3, // corresponds to a data of u8 (is an index into the extraAccountMetas list)
        ACCOUNT_DATA: 4,
    });

    /**
     * @param {Types}  discriminator
     * @param {number} data
     */
    constructor(discriminator, data) {
        switch (discriminator) {
            case Seed.Types.NULL:
            case Seed.Types.LITERAL:
            case Seed.Types.INSTRUCTION_ARG:
            case Seed.Types.ACCOUNT_DATA:
                throw Error("not implemented");
            case Seed.Types.ACCOUNT_KEY:
                this.data = [data];
                break;
            default: {
                /** @type {never} */ const _exhaustiveCheck = discriminator;
                throw Error("unreachable");
            }

        }
        this.discriminator = discriminator;
    }

    toBytes() {
        if (this.discriminator !== Seed.Types.ACCOUNT_KEY) {
            throw Error("not implemented");
        }
        return Uint8Array.from([this.discriminator, ...this.data])
    }
}

/**
 * @param {Seed[]} seeds
 * @returns {Uint8Array}
 */
function seedsToAddressConfig(seeds) {
    let data = new Uint8Array(32);
    data.set(seeds.flatMap((seed, i) => Array.from(seed.toBytes())), 0);
    return data;
}

/**
 * @implements {DataType<EAM>}
 */
export class ExtraAccountMeta {
    static LAYOUT = ExtraAccountMetaLayout;

    /**
     * @param {object} params
     * @param {number} params.discriminator
     * @param {Uint8Array} params.addressConfig
     * @param {boolean} params.isSigner
     * @param {boolean} params.isWritable
     */
    constructor({ discriminator, addressConfig, isSigner, isWritable }) {
        this.discriminator = discriminator;
        this.addressConfig = addressConfig;
        this.isSigner = isSigner;
        this.isWritable = isWritable;
    }

    get data() {
        return this;
    }

    getSize() {
        return ExtraAccountMeta.LAYOUT.span;
    }

    toBytes() {
        let buffer = new Uint8Array(this.getSize());
        ExtraAccountMeta.LAYOUT.encode(this.data, buffer);
        return buffer;
    }

    /**
     * @param {Uint8Array} buffer
     */
    static fromBytes(buffer) {
        let data = ExtraAccountMeta.LAYOUT.decode(buffer);
        return new ExtraAccountMeta(data);
    }
}

// ======================================== Default Constructors ========================================

/**
 * @returns {MintAccount}
 */
export function get_default_comptoken_mint() {
    return new MintAccount(
        compto_public_keys.comptoken_mint_pubkey,
        BIG_NUMBER,
        TOKEN_2022_PROGRAM_ID,
        new Mint({
            mintAuthorityOption: 1,
            mintAuthority: compto_public_keys.global_data_account_pubkey,
            supply: 0n,
            decimals: COMPTOKEN_DECIMALS,
            isInitialized: true,
            freezeAuthorityOption: 0,
            freezeAuthority: PublicKey.default,
        }).addExtensions(TLV.TransferHook(compto_public_keys.compto_transfer_hook_id_pubkey))
    );
}

/**
 * @returns {GlobalDataAccount}
 */
export function get_default_global_data() {
    return new GlobalDataAccount(
        compto_public_keys.global_data_account_pubkey,
        BIG_NUMBER,
        compto_public_keys.compto_program_id_pubkey,
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
                verifiedHumans: 0n,
                oldestHistoricValue: 0n,
                historicDistributions: Array.from({ length: GlobalData.DAILY_DISTRIBUTION_HISTORY_SIZE }, (v, i) => ({ interestRate: 0, ubiAmount: 0n })),
            },
        }));
}

/**
 * @param {PublicKey} address
 * @param {PublicKey} owner
 * @returns {TokenAccount}
 */
export function get_default_comptoken_token_account(address, owner) {
    return new TokenAccount(address, BIG_NUMBER, TOKEN_2022_PROGRAM_ID,
        new Token({
            mint: compto_public_keys.comptoken_mint_pubkey,
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

/** @returns {TokenAccount} */
export function get_default_unpaid_interest_bank() {
    return get_default_comptoken_token_account(compto_public_keys.interest_bank_account_pubkey, compto_public_keys.global_data_account_pubkey);
}

/** @returns {TokenAccount} */
export function get_default_unpaid_verified_human_ubi_bank() {
    return get_default_comptoken_token_account(compto_public_keys.verified_human_ubi_bank_account_pubkey, compto_public_keys.global_data_account_pubkey);
}

/** @returns {TokenAccount} */
export function get_default_unpaid_future_ubi_bank() {
    return get_default_comptoken_token_account(compto_public_keys.future_ubi_bank_account_pubkey, compto_public_keys.global_data_account_pubkey);
}

/**
 * @param {PublicKey} address 
 * @returns {UserDataAccount}
 */
export function get_default_user_data_account(address) {
    return new UserDataAccount(
        address,
        BIG_NUMBER,
        compto_public_keys.compto_program_id_pubkey,
        new UserData({
            lastInterestPayoutDate: DEFAULT_DISTRIBUTION_TIME,
            isVerifiedHuman: false,
            length: 0n,
            recentBlockhash: new Uint8Array(32),
            proofs: Array.from({ length: 8 }, (v, i) => new Uint8Array(32)),
        }));
}

/**
 * @returns {ExtraAccountMetaAccount}
 */
export function get_default_extra_account_metas_account() {
    let extraAccountsMetaList = [
        new ExtraAccountMeta({
            discriminator: 0, // Literal
            addressConfig: compto_public_keys.compto_program_id_pubkey.toBytes(),
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
    let acct = new ExtraAccountMetaAccount(
        compto_public_keys.compto_extra_account_metas_account_pubkey,
        BIG_NUMBER,
        compto_public_keys.compto_transfer_hook_id_pubkey,
        new ExtraAccountMetaAccountData({
            // value is solanas transfer hook execute instruction discriminator
            // https://github.com/solana-labs/solana-program-library/blob/token-2022-v3.0/token/js/src/extensions/transferHook/instructions.ts#L168
            instructionDiscriminator: Buffer.from([105, 37, 101, 197, 75, 251, 102, 26]).readBigUInt64LE(0),
            length: 16 + extraAccountsMetaList.length * ExtraAccountMetaLayout.span,
            extraAccountsList: { count: extraAccountsMetaList.length, extraAccounts: extraAccountsMetaList, },
        }));
    return acct;
}