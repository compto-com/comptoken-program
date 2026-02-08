import { AnchorProvider, Program, Wallet, setProvider, web3 } from "@coral-xyz/anchor";
import "dotenv/config";
import fs from "fs";
import { createLogger, format, transports } from "winston";
import type { SolanaWorldIdProgram } from "../../target/types/solana_world_id_program";

const idl: SolanaWorldIdProgram = JSON.parse(fs.readFileSync("../../target/idl/solana_world_id_program.json", "utf8"));

//const envFile = import.meta.dirname;
const envFile = `${__dirname}/.env`;

function fetchEnvSettings() {
    const envVar: Record<string, string | undefined> = {};
    if (fs.existsSync(envFile)) {
        fs.readFileSync(envFile, "utf8")
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length !== 0 && !line.startsWith("#"))
            .reduce((acc, line) => {
                const [key, value] = line.split("=");
                if (key && value) {
                    acc[key.trim()] = value.trim();
                }
                return acc;
            }, envVar);
    }
    // `||` is used instead of `??` to ignore empty string values
    // i.e. if process.env.LOG_LEVEL is "", it should still use envVar.LOG_LEVEL
    return {
        LOG_LEVEL: process.env.LOG_LEVEL || envVar.LOG_LEVEL || "info",
        NETWORK: process.env.NETWORK || envVar.NETWORK || "mainnet",
        MOCK: process.env.MOCK || envVar.MOCK || "false",
        QUERY_API_KEY: process.env.QUERY_API_KEY || envVar.QUERY_API_KEY || undefined,
        SLEEP: process.env.SLEEP || envVar.SLEEP || "0",
        CLEANUP: process.env.CLEANUP || envVar.CLEANUP || "0",
        ETH_RPC_URL: process.env.ETH_RPC_URL || envVar.ETH_RPC_URL || undefined,
        SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || envVar.SOLANA_RPC_URL || undefined,
        WALLET: process.env.WALLET || envVar.WALLET || "../tests/keys/pFCBP4bhqdSsrWUVTgqhPsLrfEdChBK17vgFM7TxjxQ.json",
    };
}

export function getEnv(needsQueryApiKeyOrMock: boolean = false) {
    const env = fetchEnvSettings();

    const logger = createLogger({
        level: env.LOG_LEVEL,
        format: format.combine(
            format.simple(),
            format.errors({ stack: true }),
            format.timestamp({
                format: "YYYY-MM-DD HH:mm:ss.SSS ZZ",
            }),
            format.printf((info) => {
                // log format: [YYYY-MM-DD HH:mm:ss.SSS A ZZ] [level] [source] message
                const source = info.source || "main";
                return `[${info.timestamp}] [${info.level}] [${source}] ${info.message}`;
            }),
        ),
        transports: [new transports.Console()],
    });
    const envLogger = logger.child({ source: "env" });

    const NETWORK = env.NETWORK === "localnet" ? "localnet" : env.NETWORK === "testnet" ? "testnet" : "mainnet";
    envLogger.info(`Network:          ${NETWORK}`);
    const MOCK = NETWORK === "localnet" || env.MOCK === "true";
    const QUERY_URL =
        NETWORK === "testnet" ? "https://testnet.query.wormhole.com/v1/query" : "https://query.wormhole.com/v1/query";
    const QUERY_API_KEY = env.QUERY_API_KEY;
    if (needsQueryApiKeyOrMock && !MOCK && !QUERY_API_KEY) {
        throw new Error("QUERY_API_KEY is required when MOCK is not set");
    }
    const SLEEP = parseInt(env.SLEEP) * 1000;
    const CLEANUP = parseInt(env.CLEANUP) * 1000;

    const ETH_RPC_URL =
        env.ETH_RPC_URL ??
        (NETWORK === "testnet" ? "https://ethereum-sepolia-rpc.publicnode.com" : "https://ethereum-rpc.publicnode.com");
    // https://docs.wormhole.com/wormhole/reference/constants
    const ETH_CHAIN_ID = NETWORK === "testnet" ? 10002 : 2;
    // https://docs.worldcoin.org/reference/address-book
    // https://etherscan.io/address/0xf7134CE138832c1456F2a91D64621eE90c2bddEa
    const ETH_WORLD_ID_IDENTITY_MANAGER =
        NETWORK === "testnet"
            ? "0xb2ead588f14e69266d1b87936b75325181377076"
            : "0xf7134CE138832c1456F2a91D64621eE90c2bddEa";
    // web3.eth.abi.encodeFunctionSignature("latestRoot()");
    const LATEST_ROOT_SIGNATURE = "0xd7b0fef1";
    envLogger.info(`Identity Manager: ${ETH_WORLD_ID_IDENTITY_MANAGER}`);

    const SOLANA_RPC_URL =
        env.SOLANA_RPC_URL ??
        (NETWORK === "localnet"
            ? "http://127.0.0.1:8899"
            : NETWORK === "testnet"
            ? "https://api.devnet.solana.com"
            : "https://api.mainnet-beta.solana.com");

    // https://docs.wormhole.com/wormhole/reference/constants
    const coreBridgeAddress = new web3.PublicKey(
        NETWORK === "testnet"
            ? "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5"
            : "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth",
    );
    const mockGuardianSetIndex = NETWORK === "localnet" ? 5 : undefined;

    const connection = new web3.Connection(SOLANA_RPC_URL, "confirmed");
    if (NETWORK !== "localnet" && !env.WALLET) {
        throw new Error("WALLET is required when NETWORK !== 'localnet'");
    }
    const PAYER_PRIVATE_KEY = Buffer.from(require(env.WALLET));
    const wallet = new Wallet(web3.Keypair.fromSecretKey(PAYER_PRIVATE_KEY));
    envLogger.info(`Wallet:           ${wallet.publicKey.toString()}`);

    const provider = new AnchorProvider(connection, wallet);
    setProvider(provider);

    const program = new Program<SolanaWorldIdProgram>(idl);

    return {
        NETWORK,
        MOCK,
        QUERY_URL,
        QUERY_API_KEY,
        SLEEP,
        CLEANUP,
        ETH_RPC_URL,
        ETH_CHAIN_ID,
        ETH_WORLD_ID_IDENTITY_MANAGER,
        LATEST_ROOT_SIGNATURE,
        SOLANA_RPC_URL,
        coreBridgeAddress,
        mockGuardianSetIndex,
        provider,
        program,
        logger,
        wallet,
    };
}
