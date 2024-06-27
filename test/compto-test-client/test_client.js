import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction
} from "@solana/web3.js";

import {
    AuthorityType,
    TOKEN_PROGRAM_ID,
    setAuthority,
    unpackMint,
} from '@solana/spl-token';

import {
    Instruction,
    compto_program_id_pubkey,
    comptoken_pubkey,
    destination_pubkey,
    me_keypair,
    static_pda_pubkey,
} from './common.js';

import { mintComptokens } from "./comptoken_proof.js";

const temp_keypair = Keypair.generate();

console.log("me: " + me_keypair.publicKey);
console.log("destination: " + destination_pubkey);
console.log("tempkeypair: " + temp_keypair.publicKey);
console.log("compto_token: " + comptoken_pubkey);
console.log("compto_program_id: " + compto_program_id_pubkey);
console.log("static_pda: " + static_pda_pubkey);

let connection = new Connection('http://localhost:8899', 'recent');

(async () => {
    await airdrop(temp_keypair.publicKey);
    await setMintAuthorityIfNeeded();
    await testMint();
    await initializeStaticAccount();
    await mintComptokens(connection, temp_keypair.publicKey, compto_program_id_pubkey, temp_keypair);
    
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
    let me_signer = { publicKey: me_keypair.publicKey, secretKey: me_keypair.secretKey }
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
