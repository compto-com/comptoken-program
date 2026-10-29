import { addresses } from "@compto/comptoken.js";
import { default as anchor, BorshCoder, type Idl as AnchorIdl, type Program } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import fs from "fs";
import type { AddedAccount } from "solana-bankrun";
const { BN } = anchor;
const { getUnstakedMintAddress } = addresses;

import {
    baseProgram,
    createMintAddedAccount,
    createTokenAccountAddedAccount,
    USDC_DECIMALS,
    type ComptokenProgram,
} from "./accountPreinitHelpers.ts";

// Helpers for standing up the COMP/USDC pool of our raydium cp-swap fork (loaded via [[test.genesis]] in Anchor.toml)
// directly as bankrun accounts, so that add_liquidity's swap and deposit CPIs run against real raydium code with
// fully controlled reserves and oracle history.

const projectRoot = `${import.meta.dirname}/../../..`;
export const raydiumIdl = JSON.parse(fs.readFileSync(`${projectRoot}/idls/raydium_cp_swap.json`, "utf8")) as AnchorIdl;
export const raydiumCoder = new BorshCoder(raydiumIdl);
export const RAYDIUM_CP_SWAP_PROGRAM_ID = new PublicKey(raydiumIdl.address);

const Q32 = 1n << 32n;
const OBSERVATION_NUM = 100;
const LP_MINT_DECIMALS = 9;

function raydiumConstantBytes(name: string): Buffer {
    const constant = raydiumIdl.constants!.find((c) => c.name === name);
    if (constant === null || constant === undefined) {
        throw new Error(`bad raydium constant name: ${name}`);
    }
    return Buffer.from(JSON.parse(constant.value));
}

export function getRaydiumAuthorityAndBump(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([raydiumConstantBytes("AUTH_SEED")], RAYDIUM_CP_SWAP_PROGRAM_ID);
}

export function getAmmConfigAddressAndBump(
    index: number = baseProgram.constants.raydiumAmmConfigIndex,
): [PublicKey, number] {
    const indexBytes = Buffer.alloc(2);
    indexBytes.writeUInt16BE(index);
    return PublicKey.findProgramAddressSync(
        [raydiumConstantBytes("AMM_CONFIG_SEED"), indexBytes],
        RAYDIUM_CP_SWAP_PROGRAM_ID,
    );
}

export function getAmmConfigAddress(index?: number): PublicKey {
    return getAmmConfigAddressAndBump(index)[0];
}

/** Raydium orders a pool's tokens by ascending pubkey bytes. */
export function isComptokenToken0(): boolean {
    const unstakedMint = getUnstakedMintAddress(baseProgram);
    return Buffer.compare(unstakedMint.toBuffer(), baseProgram.constants.usdcMintAddress.toBuffer()) < 0;
}

export function getPoolAddresses(poolState: PublicKey = baseProgram.constants.compUsdcPoolAddress) {
    const unstakedMint = getUnstakedMintAddress(baseProgram);
    const usdcMint = baseProgram.constants.usdcMintAddress;
    const vault = (mint: PublicKey) =>
        PublicKey.findProgramAddressSync(
            [raydiumConstantBytes("POOL_VAULT_SEED"), poolState.toBuffer(), mint.toBuffer()],
            RAYDIUM_CP_SWAP_PROGRAM_ID,
        )[0];
    return {
        poolState,
        ammConfig: getAmmConfigAddress(),
        lpMint: PublicKey.findProgramAddressSync(
            [raydiumConstantBytes("POOL_LP_MINT_SEED"), poolState.toBuffer()],
            RAYDIUM_CP_SWAP_PROGRAM_ID,
        )[0],
        observationState: PublicKey.findProgramAddressSync(
            [raydiumConstantBytes("OBSERVATION_SEED"), poolState.toBuffer()],
            RAYDIUM_CP_SWAP_PROGRAM_ID,
        )[0],
        poolComptokenVault: vault(unstakedMint),
        poolUsdcVault: vault(usdcMint),
    };
}

export type PoolAddresses = ReturnType<typeof getPoolAddresses>;

export async function createAmmConfigAddedAccount({
    address = getAmmConfigAddress(),
    tradeFeeRate = 0,
    protocolFeeRate = 0,
    fundFeeRate = 0,
    creatorFeeRate = 0,
}: {
    address?: PublicKey;
    tradeFeeRate?: number;
    protocolFeeRate?: number;
    fundFeeRate?: number;
    creatorFeeRate?: number;
} = {}): Promise<AddedAccount> {
    const [, bump] = getAmmConfigAddressAndBump();
    const accountData = {
        bump,
        disable_create_pool: false,
        index: baseProgram.constants.raydiumAmmConfigIndex,
        trade_fee_rate: new BN(tradeFeeRate),
        protocol_fee_rate: new BN(protocolFeeRate),
        fund_fee_rate: new BN(fundFeeRate),
        create_pool_fee: new BN(0),
        protocol_owner: Keypair.generate().publicKey,
        fund_owner: Keypair.generate().publicKey,
        creator_fee_rate: new BN(creatorFeeRate),
        padding: new Array(15).fill(new BN(0)),
    };
    const data = await raydiumCoder.accounts.encode("AmmConfig", accountData);

    return {
        address,
        info: {
            owner: RAYDIUM_CP_SWAP_PROGRAM_ID,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

export async function createPoolStateAddedAccount({
    pool,
    lpSupply,
    overrides = {},
}: {
    pool: PoolAddresses;
    lpSupply: bigint;
    /** overrides for individual (snake_case) PoolState fields, e.g. to point the pool at the wrong lp_mint */
    overrides?: Record<string, unknown>;
}): Promise<AddedAccount> {
    const comptokenIsToken0 = isComptokenToken0();
    const unstakedMint = getUnstakedMintAddress(baseProgram);
    const usdcMint = baseProgram.constants.usdcMintAddress;
    const comptokenSide = { vault: pool.poolComptokenVault, mint: unstakedMint, program: TOKEN_2022_PROGRAM_ID };
    const usdcSide = { vault: pool.poolUsdcVault, mint: usdcMint, program: TOKEN_PROGRAM_ID };
    const [token0, token1] = comptokenIsToken0 ? [comptokenSide, usdcSide] : [usdcSide, comptokenSide];
    const comptokenDecimals = baseProgram.constants.mintDecimals;
    const [, authBump] = getRaydiumAuthorityAndBump();

    const accountData = {
        amm_config: pool.ammConfig,
        pool_creator: Keypair.generate().publicKey,
        token_0_vault: token0.vault,
        token_1_vault: token1.vault,
        lp_mint: pool.lpMint,
        token_0_mint: token0.mint,
        token_1_mint: token1.mint,
        token_0_program: token0.program,
        token_1_program: token1.program,
        observation_key: pool.observationState,
        auth_bump: authBump,
        status: 0, // deposit, withdraw and swap all enabled
        lp_mint_decimals: LP_MINT_DECIMALS,
        mint_0_decimals: comptokenIsToken0 ? comptokenDecimals : USDC_DECIMALS,
        mint_1_decimals: comptokenIsToken0 ? USDC_DECIMALS : comptokenDecimals,
        lp_supply: new BN(lpSupply.toString()),
        protocol_fees_token_0: new BN(0),
        protocol_fees_token_1: new BN(0),
        fund_fees_token_0: new BN(0),
        fund_fees_token_1: new BN(0),
        open_time: new BN(0),
        recent_epoch: new BN(0),
        creator_fee_on: 0,
        enable_creator_fee: false,
        padding1: new Array(6).fill(0),
        creator_fees_token_0: new BN(0),
        creator_fees_token_1: new BN(0),
        padding: new Array(28).fill(new BN(0)),
        ...overrides,
    };
    const data = await raydiumCoder.accounts.encode("PoolState", accountData);
    expect(data.length).to.equal(raydiumCoder.accounts.size("PoolState"), "PoolState data length mismatch");

    return {
        address: pool.poolState,
        info: {
            owner: RAYDIUM_CP_SWAP_PROGRAM_ID,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

export type ObservationSample = {
    /** unix timestamp (seconds) of the observation */
    timestamp: number;
    /** price of token_0 in token_1 (raw units) over the period leading up to this observation */
    token0Price: number;
};

/** Q32.32 price of token_0 in token_1, as raydium's oracle records it. */
function toX32(price: number): bigint {
    // split to keep precision for prices that aren't small integers
    const scaled = BigInt(Math.round(price * 2 ** 20));
    return (scaled * Q32) >> 20n;
}

/**
 * Builds an observation state whose ring buffer holds `samples` in order, accumulated the way raydium does (each
 * sample's price applies over the time since the previous sample).
 */
export function createObservationStateAddedAccount({
    pool,
    samples,
    initialized = true,
}: {
    pool: PoolAddresses;
    samples: ObservationSample[];
    initialized?: boolean;
}): AddedAccount {
    expect(samples.length).to.be.within(1, OBSERVATION_NUM);
    const observations = new Array(OBSERVATION_NUM).fill({ blockTimestamp: 0n, cumulative0: 0n, cumulative1: 0n });
    let cumulative0 = 0n;
    let cumulative1 = 0n;
    let previousTimestamp = samples[0].timestamp;
    samples.forEach(({ timestamp, token0Price }, i) => {
        const elapsed = BigInt(timestamp - previousTimestamp);
        const price0X32 = toX32(token0Price);
        cumulative0 += price0X32 * elapsed;
        cumulative1 += ((Q32 * Q32) / price0X32) * elapsed;
        observations[i] = { blockTimestamp: BigInt(timestamp), cumulative0, cumulative1 };
        previousTimestamp = timestamp;
    });

    // ObservationState is too large for raydiumCoder.accounts.encode's fixed buffer, so encode manually (packed layout)
    const data = Buffer.alloc(raydiumCoder.accounts.size("ObservationState"));
    let offset = 0;
    data.set(raydiumCoder.accounts.accountDiscriminator("ObservationState"), offset);
    offset += 8;
    data.writeUInt8(initialized ? 1 : 0, offset);
    offset += 1;
    data.writeUInt16LE(samples.length - 1, offset); // observation_index
    offset += 2;
    data.set(pool.poolState.toBuffer(), offset);
    offset += 32;
    for (const { blockTimestamp, cumulative0, cumulative1 } of observations) {
        data.writeBigUInt64LE(blockTimestamp, offset);
        offset += 8;
        offset = writeU128LE(cumulative0, data, offset);
        offset = writeU128LE(cumulative1, data, offset);
    }
    data.writeBigUInt64LE(BigInt(previousTimestamp), offset); // last_update_timestamp
    offset += 8;
    offset += 3 * 8; // padding
    expect(offset).to.equal(data.length, "ObservationState data length mismatch");

    const decoded = raydiumCoder.accounts.decode("ObservationState", data);
    expect(decoded.observation_index).to.equal(samples.length - 1);
    expect(decoded.last_update_timestamp.toString()).to.equal(previousTimestamp.toString());

    return {
        address: pool.observationState,
        info: {
            owner: RAYDIUM_CP_SWAP_PROGRAM_ID,
            data,
            executable: false,
            lamports: 1_000_000_000, // arbitrary lamport amount
        },
    };
}

function writeU128LE(value: bigint, buffer: Buffer, offset: number): number {
    const wrapped = BigInt.asUintN(128, value);
    buffer.writeBigUInt64LE(wrapped & ((1n << 64n) - 1n), offset);
    buffer.writeBigUInt64LE(wrapped >> 64n, offset + 8);
    return offset + 16;
}

/** Observation history in which the pool has traded at a constant `token0Price` for the past `historySeconds`. */
export function steadyPriceHistory({
    token0Price,
    historySeconds = 2 * Number(baseProgram.constants.liquidityTwapMinWindowSeconds),
    now = Math.floor(Date.now() / 1000),
}: {
    token0Price: number;
    historySeconds?: number;
    now?: number;
}): ObservationSample[] {
    // last observation a minute ago, so the next swap starts a new observation rather than accumulating into it
    const latest = now - 60;
    return [
        { timestamp: latest - historySeconds, token0Price },
        { timestamp: latest, token0Price },
    ];
}

/** Spot price of token_0 in token_1 for the given comptoken/usdc reserves. */
export function token0SpotPrice(comptokenReserve: bigint, usdcReserve: bigint): number {
    return isComptokenToken0()
        ? Number(usdcReserve) / Number(comptokenReserve)
        : Number(comptokenReserve) / Number(usdcReserve);
}

/**
 * All accounts making up the COMP/USDC pool (amm config, pool state, oracle, vaults and lp mint). By default the
 * oracle shows the pool having traded at its current spot price for longer than the TWAP window.
 */
export async function createComptokenUsdcPoolAddedAccounts({
    comptokenReserve,
    usdcReserve,
    lpSupply = sqrt(comptokenReserve * usdcReserve),
    observations = steadyPriceHistory({ token0Price: token0SpotPrice(comptokenReserve, usdcReserve) }),
    ammConfig = {},
    poolStateOverrides = {},
}: {
    comptokenReserve: bigint;
    usdcReserve: bigint;
    lpSupply?: bigint;
    observations?: ObservationSample[];
    ammConfig?: Parameters<typeof createAmmConfigAddedAccount>[0];
    poolStateOverrides?: Record<string, unknown>;
}): Promise<{ pool: PoolAddresses; accounts: AddedAccount[] }> {
    const pool = getPoolAddresses();
    const [raydiumAuthority] = getRaydiumAuthorityAndBump();

    const accounts = [
        await createAmmConfigAddedAccount(ammConfig),
        await createPoolStateAddedAccount({ pool, lpSupply, overrides: poolStateOverrides }),
        createObservationStateAddedAccount({ pool, samples: observations }),
        createTokenAccountAddedAccount({
            address: pool.poolComptokenVault,
            mint: getUnstakedMintAddress(baseProgram),
            owner: raydiumAuthority,
            amount: comptokenReserve,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
        }),
        createTokenAccountAddedAccount({
            address: pool.poolUsdcVault,
            mint: baseProgram.constants.usdcMintAddress,
            owner: raydiumAuthority,
            amount: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
        }),
        createMintAddedAccount({
            address: pool.lpMint,
            mintAuthority: raydiumAuthority,
            supply: lpSupply,
            decimals: LP_MINT_DECIMALS,
            tokenProgram: TOKEN_PROGRAM_ID,
        }),
    ];

    return { pool, accounts };
}

export async function fetchPoolState(program: ComptokenProgram, pool: PoolAddresses) {
    const info = await program.provider.connection.getAccountInfo(pool.poolState);
    return raydiumCoder.accounts.decode("PoolState", info!.data);
}

export function sqrt(value: bigint): bigint {
    if (value < 2n) {
        return value;
    }
    let x = BigInt(Math.floor(Math.sqrt(Number(value))));
    while (x * x > value) x--;
    while ((x + 1n) * (x + 1n) <= value) x++;
    return x;
}

export async function addLiquidity({
    program,
    pool,
    accounts = {},
}: {
    program: ComptokenProgram;
    pool: PoolAddresses;
    accounts?: Partial<Omit<PoolAddresses, "poolState">>;
}) {
    return program.methods
        .addLiquidity()
        .accountsPartial({
            lpMint: accounts.lpMint ?? pool.lpMint,
            poolComptokenVault: accounts.poolComptokenVault ?? pool.poolComptokenVault,
            poolUsdcVault: accounts.poolUsdcVault ?? pool.poolUsdcVault,
            ammConfig: accounts.ammConfig ?? pool.ammConfig,
            observationState: accounts.observationState ?? pool.observationState,
        })
        .rpc();
}
