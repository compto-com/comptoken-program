import {
    Account,
    COMPTOKEN_DECIMALS,
    DataType,
    DataTypeWithExtensions,
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

class Seed {
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
                historicDistributions: Array.from({ length: GlobalData.DAILY_DISTRIBUTION_HISTORY_SIZE }, (v, i) => [0, 0n]),
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