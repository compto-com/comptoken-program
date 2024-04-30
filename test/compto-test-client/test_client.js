// const  = require("@solana/web3.js");

const {
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  sendAndConfirmTransaction,
  clusterApiUrl,
  Connection,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY
} = require("@solana/web3.js");
const fs = require('fs');
const { 
  setAuthority,
  AuthorityType,
  TOKEN_PROGRAM_ID
} = require('@solana/spl-token');
const bs58 = require('bs58');

// let splTokenId = TOKEN_PROGRAM_ID;
let compto_token_id_str = require("../../compto_token_id.json")["commandOutput"]["address"]
let compto_program_id_str = require("../.cache/compto_program_id.json")['programId'];
let test_account = require("../.cache/compto_test_account.json");
// let compto_mint_authority = require("../.cache/compto_mint_authority.json")['mintAuthority'];
let destination_keypair = Keypair.fromSecretKey(new Uint8Array(test_account));
let connection = new Connection('http://localhost:8899', 'recent');

const keypairFilePath = '/home/david/.config/solana/id.json';
const keypairJson = JSON.parse(fs.readFileSync(keypairFilePath, 'utf8'));
const me_keypair = Keypair.fromSecretKey(Uint8Array.from(keypairJson));


// Pubkey bytes
const me = bs58.decode("zrnQQbTKqNVzTQBxNkQR1nkFaVQEJEkghAkcW2LfcVY");
const compto_token_bytes = bs58.decode(compto_token_id_str);
const destination_keypair_bytes = Buffer.from(destination_keypair.publicKey.toBytes());
const compto_program_id_bytes = bs58.decode(compto_program_id_str);


// Pubkeys
const me_pubkey = new PublicKey(me);
const compto_token_pubkey = new PublicKey(compto_token_bytes);
const compto_program_id_pubkey = new PublicKey(compto_program_id_bytes);
const temp_keypair = Keypair.generate();

console.log("me: " + me_pubkey);
console.log("destination: " + destination_keypair.publicKey);
console.log("tempkeypair: " + temp_keypair.publicKey);
console.log("compto_token: " + compto_token_pubkey);
console.log("compto_program_id: " + compto_program_id_pubkey);

const TESTMINT = 0;

(async () => {
    // how to create a program address based using bumpseed
    // const d2 = PublicKey.createProgramAddressSync(["compto", Buffer.alloc(1, bumpseed)], compto_program_id_pubkey);
    const [derived_address, bumpseed] = PublicKey.findProgramAddressSync(["compto"], compto_program_id_pubkey);
    await airdrop(temp_keypair.publicKey);
    await setMintAuthority(derived_address);
    await mintComptokens(derived_address, bumpseed);
    // await testMint(derived_address, bumpseed);
})();


async function airdrop(pubkey) {
    let airdropSignature = await connection.requestAirdrop(pubkey, 3*LAMPORTS_PER_SOL,);
    await connection.confirmTransaction({ signature: airdropSignature });
    console.log("Airdrop confirmed");
}

async function setMintAuthority(derived_address) {
    me_signer = {publicKey: me_pubkey, secretKey: Uint8Array.from(keypairJson)}
    const res = await setAuthority(
        connection,
        me_signer,
        compto_token_pubkey,
        me_signer,
        AuthorityType.MintTokens,
        derived_address
    );
}

async function mintComptokens(derived_address, bumpseed) {
    let data = Buffer.from([1, bumpseed]);
    let keys = [{ pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
                { pubkey: destination_keypair.publicKey, isSigner: false, isWritable: true },];
                // { pubkey: derived_address, isSigner: false, isWritable: false},
                // { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                // { pubkey: compto_program_id_pubkey, isSigner: false, isWritable: false },
                // { pubkey: compto_token_pubkey, isSigner: false, isWritable: true },];
    let mintComptokensTransaction = new Transaction();
    mintComptokensTransaction.add(
        new TransactionInstruction({
            keys: keys,
            programId: compto_program_id_pubkey,
            data: data,
        }),
    );
    let mintComptokensResult = await sendAndConfirmTransaction(connection, mintComptokensTransaction, [temp_keypair, temp_keypair]);
    console.log("mintComptokens transaction confirmed", mintComptokensResult);
}

async function testMint(derived_address, bumpseed) {
    let data = Buffer.from([1, bumpseed]);
    let keys = [{ pubkey: destination_keypair.publicKey, isSigner: false, isWritable: true },
                { pubkey: derived_address, isSigner: false, isWritable: false},
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: compto_program_id_pubkey, isSigner: false, isWritable: false },
                { pubkey: compto_token_pubkey, isSigner: false, isWritable: true },];
    let testMintTransaction = new Transaction();
    testMintTransaction.add(
        new TransactionInstruction({
            keys: keys,
            programId: compto_program_id_pubkey,
            data: data,
        }),
    );
    let testMintResult = await sendAndConfirmTransaction(connection, testMintTransaction, [temp_keypair, temp_keypair]);
    console.log("testMint transaction confirmed", testMintResult);
}