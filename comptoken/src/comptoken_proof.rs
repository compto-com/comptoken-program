use spl_token_2022::solana_program::{
    hash::{hash, hashv, Hash},
    msg,
    pubkey::Pubkey,
};

use comptoken_utils::verify_accounts::VerifiedAccountInfo;

use crate::global_data::valid_blockhashes::ValidBlockhashes;

// Ensure changes to this struct remain consistent with comptoken_proof.js
#[derive(Debug)]
pub struct ComptokenProof {
    pub pubkey: Pubkey,
    pub hash: Hash,
}

// 4 bytes: <version>
// 32 bytes: <previous block hash according to the compto program>
// 32 bytes: <merkle root>
//     32 bytes: <unspecified data>
//     32 bytes: solana public key
// 4 bytes: <timestamp>
// 4 bytes: <bits> <-- defined to ...
// 4 bytes: <nonce>
impl ComptokenProof {
    pub const SUBMITTED_DATA_SIZE: usize = 76;
    // larger difficulty = easier
    #[allow(dead_code)]
    const TARGET_DIFFICULTY_TEST: usize = 29;
    #[allow(dead_code)]
    const TARGET_DIFFICULTY_PROD: usize = 24;
    pub const TARGET_DIFFICULTY: usize = Self::TARGET_DIFFICULTY_TEST; // todo: change to prod

    // The target is 0x0e_ad_d8 followed by <difficulty> zero bytes
    const fn make_target_bytes(difficulty: usize) -> [u8; 32] {
        let mut target_bytes = [0; 32];
        target_bytes[32 - (difficulty + 3)] = 0x0e;
        target_bytes[32 - (difficulty + 2)] = 0xad;
        target_bytes[32 - (difficulty + 1)] = 0xd8;
        target_bytes
    }

    pub const TARGET_BYTES: [u8; 32] = Self::make_target_bytes(Self::TARGET_DIFFICULTY);

    pub fn from_bytes(data: &[u8; Self::SUBMITTED_DATA_SIZE], valid_blockhashes: &ValidBlockhashes) -> Self {
        let pubkey_bytes = &data[00..32];
        let extra_data = &data[32..64];
        let nonce = &data[64..68];
        let version = &data[68..72];
        let timestamp = &data[72..76];

        let valid_blockhash_bytes = &mut valid_blockhashes.valid_blockhash.to_bytes();
        valid_blockhash_bytes.reverse();

        msg!("extra_data: {:?}", hex::encode(extra_data));
        msg!("pubkey_bytes: {:?}", hex::encode(pubkey_bytes));

        let merkleroot_hash1 = hashv(&[extra_data, pubkey_bytes]);
        let merkleroot_hash2 = hash(merkleroot_hash1.as_ref());

        let nbits = &[0xd8_u8, 0xad_u8, 0x0e_u8, 0x18_u8];

        let header_fields: &[&[u8]] =
            &[version, valid_blockhash_bytes, &merkleroot_hash2.to_bytes(), timestamp, nbits, nonce];

        assert!(header_fields.iter().fold(0, |acc, field| acc + field.len()) == 80);

        let hash1 = hashv(header_fields);
        let hash2 = hash(hash1.as_ref());

        let mut final_hash = hash2.to_bytes();
        final_hash.reverse();

        msg!("Final Hash: {:?}", hex::encode(final_hash));
        let pubkey = Pubkey::new_from_array(pubkey_bytes.try_into().expect("correct length"));
        Self { pubkey, hash: Hash::new_from_array(final_hash) }
    }

    pub fn is_hash_lower_than_target(hash: &Hash) -> bool {
        // The target is 0x0e_ad_d8 * (2^8)^<difficulty> (larger difficulty = easier)

        // Get the byte array from the hash
        let hash_bytes = hash.to_bytes();
        // Compare the hash byte array to the target byte array
        // This will compare the arrays lexicographically (byte by byte)
        hash_bytes < Self::TARGET_BYTES
    }

    pub fn verify_submitted_proof(
        comptoken_wallet: &VerifiedAccountInfo, data: &[u8; Self::SUBMITTED_DATA_SIZE],
        valid_blockhashes: &ValidBlockhashes,
    ) -> Self {
        let proof = ComptokenProof::from_bytes(data, valid_blockhashes);
        proof.verify_proof(valid_blockhashes, comptoken_wallet);
        proof
    }

    fn verify_proof(&self, valid_blockhashes: &ValidBlockhashes, comptoken_wallet: &VerifiedAccountInfo) {
        assert!(ComptokenProof::is_hash_lower_than_target(&self.hash));
        assert!(!valid_blockhashes.is_valid_blockhash_stale());
        assert_eq!(comptoken_wallet.key, &self.pubkey);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use spl_token_2022::solana_program::pubkey::PUBKEY_BYTES;

    const ZERO_PUBKEY: Pubkey = Pubkey::new_from_array([0; PUBKEY_BYTES]);

    fn sub(this: &mut [u8; 32], other: u8) {
        let mut borrow = other as i16;
        for byte in this.iter_mut().rev() {
            let result = *byte as i16 - borrow;
            *byte = result as u8;
            borrow = if result < 0 { 1 } else { 0 };
        }
    }

    fn add(this: &mut [u8; 32], other: u8) {
        let mut borrow = other as i16;
        for byte in this.iter_mut().rev() {
            let result = *byte as i16 + borrow;
            *byte = result as u8;
            borrow = if result > u8::MAX.into() { 1 } else { 0 };
        }
    }

    #[test]
    fn test_is_hash_lower_than_target() {
        let mut hash_array = ComptokenProof::TARGET_BYTES;
        let hash = Hash::new_from_array(hash_array);
        assert!(!ComptokenProof::is_hash_lower_than_target(&hash));

        sub(&mut hash_array, 1);
        let hash = Hash::new_from_array(hash_array);
        assert!(ComptokenProof::is_hash_lower_than_target(&hash));

        add(&mut hash_array, 2);
        let hash = Hash::new_from_array(hash_array);
        assert!(!ComptokenProof::is_hash_lower_than_target(&hash));

        let hash = Hash::new_from_array([0; 32]);
        assert!(ComptokenProof::is_hash_lower_than_target(&hash));

        let hash = Hash::new_from_array([0xff; 32]);
        assert!(!ComptokenProof::is_hash_lower_than_target(&hash));
    }

    #[test]
    fn test_from_bytes() {
        let proof = ComptokenProof::from_bytes(
            &[0; 76],
            &ValidBlockhashes {
                announced_blockhash: Hash::default(),
                announced_blockhash_time: 0,
                valid_blockhash: Hash::default(),
                valid_blockhash_time: 0,
            },
        );

        assert_eq!(proof.pubkey, ZERO_PUBKEY);
        assert_eq!(
            proof.hash,
            Hash::new(&bs58::decode("DfmD6ULzF7womD7Nav5DKHuyF3xw8jMmX9bT7wgGP5Pp").into_vec().unwrap()) // value comes from running the code and printing the hash
        );

        let pubkey = Pubkey::new_from_array([1; PUBKEY_BYTES]);
        let extra_data = [1_u8; 32]; // what is this?
        let nonce = [0_u8; 4];
        let version = [0_u8; 4];
        let timestamp = [0_u8; 4];

        let data: Vec<_> = pubkey
            .to_bytes()
            .into_iter()
            .chain(extra_data)
            .chain(nonce)
            .chain(version)
            .chain(timestamp)
            .collect();

        let valid_blockhashes = ValidBlockhashes {
            announced_blockhash: Hash::default(),
            announced_blockhash_time: 0,
            valid_blockhash: Hash::default(),
            valid_blockhash_time: 0,
        };

        let proof = ComptokenProof::from_bytes(&data.try_into().unwrap(), &valid_blockhashes);

        assert_eq!(proof.pubkey, pubkey);
        assert_eq!(
            proof.hash,
            Hash::new(&bs58::decode("6ui4sQ6LiyHZTmdb7gsyTD9QPV6KUProHxty5oyfNbBB").into_vec().unwrap()) // value comes from running the code and printing the hash
        );
    }
}
