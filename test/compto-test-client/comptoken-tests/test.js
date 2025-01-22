import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { bs58 } from "../common.js";

/**
 * @param {string} urlStr
 * @returns {boolean}
 */
function isHttpUrl(urlStr) {
    try {
        let url = new URL(urlStr);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (e) {
        return false;
    }
}

/**
 * gets all accounts owned by a key
 * @param {PublicKey} key 
 * @param {Connection} connection
 */
async function getAccountsOwnedByKey(key, connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed")) {
    if (!key) {
        throw new Error("key is required");
    }
    if (!(connection instanceof Connection)) {
        throw new Error("connection must be a Connection object");

    }

    return await connection.getProgramAccounts(key);
}

async function getRoots() {
    let connection = new Connection(clusterApiUrl("devnet"), "confirmed");
    let accounts = await connection.getProgramAccounts(
        WORLD_ID_PROGRAM,
        {
            filters: [
                {
                    dataSize: 90
                },
                //{
                //    memcmp: {
                //        offset: 0,
                //        bytes: bs58.encode(Buffer.from("0cf5e7f6bf3fa95f", "hex")),
                //    }
                //}
            ]
        },
    );
    return accounts;
}

const WORLD_ID_PROGRAM = new PublicKey(bs58.decode("9QwAWx3TKg4CaTjHNhBefQeNSzEKDe2JDxL46F76tVDv"));

let accounts = await getAccountsOwnedByKey(WORLD_ID_PROGRAM, new Connection(clusterApiUrl("devnet"), "confirmed"));

console.log(accounts.map(account => account.pubkey.toBase58()));


const possibleSeedsLatestRoot = [
    [Buffer.from("LatestRoot")],
    [Buffer.from("LatestRoot"), Buffer.from([0])],
    [Buffer.from("LatestRoot"), Buffer.from([1])],
];
possibleSeedsLatestRoot.forEach(seed => {
    const possibleLatestRoot = PublicKey.findProgramAddressSync(seed, WORLD_ID_PROGRAM)[0];
    console.log(possibleLatestRoot.toBase58(), accounts.map(account => account.pubkey.toBase58()).includes(possibleLatestRoot.toBase58()));
});

console.log();

const root_hash = Buffer.from("17a8a84c3d73588c985131943c3026eaf1e8bacd4e3466ce32d10b72d4a6341f", "hex");
const possibleSeedsRoot = [
    [Buffer.from("Root"), root_hash],
    [Buffer.from("Root"), root_hash, [0]],
    [Buffer.from("Root"), root_hash, [1]],
]
possibleSeedsRoot.forEach(seed => {
    const possibleRoot = PublicKey.findProgramAddressSync(seed, WORLD_ID_PROGRAM)[0];
    console.log(possibleRoot.toBase58(), accounts.map(account => account.pubkey.toBase58()).includes(possibleRoot.toBase58()));
});

console.log();

const configSeeds = [Buffer.from("Config")];
const config = PublicKey.findProgramAddressSync(configSeeds, WORLD_ID_PROGRAM)[0];
console.log(config.toBase58(), accounts.map(account => account.pubkey.toBase58()).includes(config.toBase58()));

let _ = {
    discriminator: Buffer.from("0cf5e7f6bf3fa95f", "hex"),
    bump: Buffer.from("fe", "hex"),
    read_block_number: Buffer.from("f458680000000000", "hex"),
    read_block_hash: Buffer.from(
        "d4a06fc31f66282919c24492c97824b8" +
        "f3c0dbef3526b187e4521e7240ff5e3a",
        "hex"
    ),
    read_block_time: Buffer.from("00b73e52f7230600", "hex"),
    root: Buffer.from(
        "01df1992cc8c17d0e2b2c2763b49f0fa" +
        "e836a2e967a24c8fa602ce3c17b7dbf4",
        "hex"
    ),
    verification_type: Buffer.from("00", "hex"),
}

let __ = {
    discriminator: Buffer.from("9b0caae01efacc82", "hex"),
    bump: Buffer.from("ff", "hex"),
    owner: Buffer.from(
        "b6833720cc6a3816ff4be565836b4c1a" +
        "806a076ba964f9dd600f1d8f41343191",
        "hex",
    ),
    pending_owner: {
        option: Buffer.from("00", "hex"),
        key: Buffer.from(
            "803a0900000000002c01000000000000" +
            "806a076ba964f9dd600f1d8f41343191",
            "hex",
        ),
    },
    root_expiry: Buffer.from("8051010000000000", "hex"),
    allowed_update_staleness: Buffer.from("2c01000000000000", "hex"),
}

console.log();

console.log(await getRoots());