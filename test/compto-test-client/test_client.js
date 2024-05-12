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
  TOKEN_PROGRAM_ID,
  unpackMint,
} = require('@solana/spl-token');
const bs58 = require('bs58');

const Instruction = {
    TEST: 0,
    COMPTOKEN_MINT: 1,
    INITIALIZE_STATIC_ACCOUNT: 2
};
let connection = new Connection('http://localhost:8899', 'recent');

// Read Cache Files
let static_pda_str = require("../.cache/compto_static_pda.json")["address"];
let static_pda_seed = require("../.cache/compto_static_pda.json")["bumpSeed"];
let compto_token_id_str = require("../.cache/comptoken_id.json")["commandOutput"]["address"]
let compto_program_id_str = require("../.cache/compto_program_id.json")['programId'];
let test_account = require("../.cache/compto_test_account.json");

// Pubkeys
const destination_pubkey = Keypair.fromSecretKey(new Uint8Array(test_account)).publicKey;
const static_pda_pubkey = new PublicKey(bs58.decode(static_pda_str));
const me_pubkey = new PublicKey(bs58.decode("zrnQQbTKqNVzTQBxNkQR1nkFaVQEJEkghAkcW2LfcVY"));
const comptoken_pubkey = new PublicKey(bs58.decode(compto_token_id_str));
const compto_program_id_pubkey = new PublicKey(bs58.decode(compto_program_id_str));
const temp_keypair = Keypair.generate();

console.log("me: " + me_pubkey);
console.log("destination: " + destination_pubkey);
console.log("tempkeypair: " + temp_keypair.publicKey);
console.log("compto_token: " + comptoken_pubkey);
console.log("compto_program_id: " + compto_program_id_pubkey);
console.log("static_pda: " + static_pda_pubkey);



(async () => {
    await airdrop(temp_keypair.publicKey);
    await setMintAuthorityIfNeeded();
    await testMint();
    await initializeStaticAccount();
    await mintComptokens();
    
})();


async function airdrop(pubkey) {
    let airdropSignature = await connection.requestAirdrop(pubkey, 3*LAMPORTS_PER_SOL,);
    await connection.confirmTransaction({ signature: airdropSignature });
    console.log("Airdrop confirmed");
}

async function setMintAuthorityIfNeeded() {
    const info = await connection.getAccountInfo(comptoken_pubkey, "confirmed");
    const unpackedMint = unpackMint(comptoken_pubkey, info, TOKEN_PROGRAM_ID);
    if (unpackedMint.mintAuthority.toString() == static_pda_pubkey.toString()) {
        console.log("Mint Authority already set, skipping setAuthority Transaction");
    } else {
        console.log("Mint Authority not set, setting Authority");
        await setMintAuthority(unpackedMint.mintAuthority);
    }
}

async function setMintAuthority(mint_authority_pubkey) {
    // My Keypair: TODO: Replace with an ephemeral keypair
    me_secret_key = Uint8Array.from(JSON.parse(fs.readFileSync('/home/david/.config/solana/id.json', 'utf8')));
    me_signer = {publicKey: me_pubkey, secretKey: me_secret_key}
    const res = await setAuthority(
        connection,
        me_signer,
        comptoken_pubkey,
        mint_authority_pubkey,
        AuthorityType.MintTokens,
        static_pda_pubkey
    );
}

async function testMint() {
    let data = Buffer.from([Instruction.TEST]);
    let keys = [
        // the address to receive the test tokens
        { pubkey: destination_pubkey, isSigner: false, isWritable: true },
        // the mint authority that will sign to mint the tokens
        { pubkey: static_pda_pubkey, isSigner: false, isWritable: false},
        // ...
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        // ...
        { pubkey: compto_program_id_pubkey, isSigner: false, isWritable: false },
        // ....
        { pubkey: comptoken_pubkey, isSigner: false, isWritable: true },
    ];
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
// under construction
async function mintComptokens() {
    let data = Buffer.from([Instruction.COMPTOKEN_MINT]);
    let keys = [{ pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
                { pubkey: destination_pubkey, isSigner: false, isWritable: true },];
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

async function initializeStaticAccount() {
    // createAccountTransaction = new Transaction();
    // createAccountTransaction.add(SystemProgram.createAccount({
    //     fromPubkey: temp_keypair.publicKey,
    //     newAccountPubkey: static_pda_pubkey,
    //     lamports: 1000, // Example lamports amount
    //     space: 256, // Example space allocation in bytes
    //     programId: compto_program_id_pubkey,
    // }));
    // let staticAccountResult = await sendAndConfirmTransaction(connection, createAccountTransaction, [temp_keypair, temp_keypair]);
    // console.log("Static Account created");


   
    // MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN comptoken.rs
    const rentExemptAmount = await connection.getMinimumBalanceForRentExemption(4096);
    console.log("Rent exempt amount: ", rentExemptAmount);
    let data = Buffer.alloc(9);
    data.writeUInt8(Instruction.INITIALIZE_STATIC_ACCOUNT, 0);
    data.writeBigInt64LE(BigInt(rentExemptAmount), 1);
    console.log("data: ", data);
    let keys = [
        { pubkey: static_pda_pubkey, isSigner: false, isWritable: true},
        { pubkey: temp_keypair.publicKey, isSigner: true, isWritable: true },
        // needed because compto program interacts with the system program to create the account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false}
        // { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        //{ pubkey: destination_pubkey, isSigner: false, isWritable: true },
        //{ pubkey: compto_program_id_pubkey, isSigner: false, isWritable: false },
    ];
    let initializeStaticAccountTransaction = new Transaction();
    initializeStaticAccountTransaction.add(
        new TransactionInstruction({
            keys: keys,
            programId: compto_program_id_pubkey,
            data: data,
        }),
    );
    let initializeStaticAccountResult = await sendAndConfirmTransaction(connection, initializeStaticAccountTransaction, [temp_keypair, temp_keypair]);
    console.log("initializeStaticAccount transaction confirmed", initializeStaticAccountResult);
    
}
// how to create a program address based using bumpseed
// const d2 = PublicKey.createProgramAddressSync(["compto", Buffer.alloc(1, bumpseed)], compto_program_id_pubkey);
// const [derived_address, bumpseed] = PublicKey.findProgramAddressSync([STATIC_ACCOUNT_SEED], compto_program_id_pubkey);

async function getRentExemptAmount(accountSizeInBytes) {
    try {
        // Get rent exempt amount for the specified account size
        
        
        console.log(`Rent exempt amount for ${accountSizeInBytes} bytes: ${rentExemptAmount} lamports`);
        
        return rentExemptAmount;
    } catch (error) {
        console.error('Error getting rent exempt amount:', error);
        throw error;
    }
}