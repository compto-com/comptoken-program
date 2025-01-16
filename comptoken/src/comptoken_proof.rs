use spl_token_2022::solana_program::{
    hash::{hashv, Hash},
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
// 4 bytes: <bits> <-- defined to 0xd8ad0e18
// 4 bytes: <nonce>
impl ComptokenProof {
    pub const SUBMITTED_DATA_SIZE: usize = 76;
    // larger difficulty = easier
    #[allow(dead_code)]
    const TARGET_DIFFICULTY_DEVNET: usize = 29;
    #[allow(dead_code)]
    const TARGET_DIFFICULTY_MAINNET: usize = 24;
    pub const TARGET_DIFFICULTY: usize = Self::TARGET_DIFFICULTY_DEVNET; // todo: change to mainnet

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

        let merkleroot_hash = hashv(&[hashv(&[extra_data, pubkey_bytes]).as_ref()]);

        let nbits = &[0xd8_u8, 0xad_u8, 0x0e_u8, 0x18_u8];

        let header_fields: &[&[u8]] =
            &[version, valid_blockhash_bytes, &merkleroot_hash.to_bytes(), timestamp, nbits, nonce];

        assert!(header_fields.iter().fold(0, |acc, field| acc + field.len()) == 80);

        let mut final_hash = hashv(&[hashv(header_fields).as_ref()]).to_bytes();
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
        assert!(proof.verify_proof(valid_blockhashes, comptoken_wallet), "invalid proof");
        proof
    }

    fn verify_proof(&self, valid_blockhashes: &ValidBlockhashes, comptoken_wallet: &VerifiedAccountInfo) -> bool {
        ComptokenProof::is_hash_lower_than_target(&self.hash)
            && !valid_blockhashes.is_valid_blockhash_stale()
            && comptoken_wallet.key == &self.pubkey
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use spl_token_2022::solana_program::pubkey::PUBKEY_BYTES;

    const ZERO_PUBKEY: Pubkey = Pubkey::new_from_array([0; PUBKEY_BYTES]);

    fn sub(this: &mut [u8; 32], other: u8) -> [u8; 32] {
        let mut result = *this;
        let mut borrow = other as i16;
        for byte in result.iter_mut().rev() {
            let byte_diff = *byte as i16 - borrow;
            *byte = byte_diff as u8;
            borrow = if byte_diff < 0 { 1 } else { 0 };
        }
        result
    }

    fn add(this: &mut [u8; 32], other: u8) -> [u8; 32] {
        let mut result = *this;
        let mut borrow = other as i16;
        for byte in result.iter_mut().rev() {
            let byte_sum = *byte as i16 + borrow;
            *byte = byte_sum as u8;
            borrow = if byte_sum > u8::MAX.into() { 1 } else { 0 };
        }
        result
    }

    #[test]
    fn test_is_hash_lower_than_target() {
        let mut hash_array = ComptokenProof::TARGET_BYTES;
        let hash = Hash::new_from_array(hash_array);
        assert!(!ComptokenProof::is_hash_lower_than_target(&hash));

        let hash = Hash::new_from_array(sub(&mut hash_array, 1));
        assert!(ComptokenProof::is_hash_lower_than_target(&hash));

        let hash = Hash::new_from_array(add(&mut hash_array, 1));
        assert!(!ComptokenProof::is_hash_lower_than_target(&hash));

        let hash = Hash::new_from_array([0; 32]);
        assert!(ComptokenProof::is_hash_lower_than_target(&hash));

        let hash = Hash::new_from_array([0xff; 32]);
        assert!(!ComptokenProof::is_hash_lower_than_target(&hash));
    }

    #[test]
    fn test_from_zero_bytes() {
        let proof = ComptokenProof::from_bytes(
            &[0; ComptokenProof::SUBMITTED_DATA_SIZE],
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
    }

    #[test]
    fn test_from_bytes() {
        // values come from running the mining pool https://github.com/compto-com/comptoken-mining-pool
        #[rustfmt::skip]
        let pubkey = Pubkey::new_from_array([
            0xc6, 0x55, 0x8f, 0x54, 0x6f, 0xf2, 0x3d, 0x01, 0xd3, 0x72, 0x11, 0xdc, 0xfa, 0xce, 0x08, 0x10,
            0x0c, 0x29, 0x15, 0x78, 0x5e, 0xa3, 0xca, 0x09, 0x2d, 0xa8, 0x58, 0x0f, 0xa2, 0x0c, 0x7f, 0x71,
        ]);
        #[rustfmt::skip]
        let extra_data = [
            0xb8, 0xa2, 0xf8, 0x3d, 0xf3, 0x8b, 0xcc, 0xa1, 0x19, 0xcc, 0x6e, 0x82, 0xb0, 0x04, 0x3f, 0x23,
            0x37, 0x0e, 0x07, 0x40, 0x6b, 0x06, 0x76, 0x82, 0x3e, 0x60, 0x69, 0x0b, 0x48, 0x81, 0x7e, 0xe2,
        ];
        let nonce = [0x01, 0x3d, 0x31, 0xa8];
        let version = [0x00, 0x00, 0x00, 0x20];
        let timestamp = [0x51, 0x2e, 0x87, 0x67];

        let data: Vec<_> = pubkey
            .to_bytes()
            .into_iter()
            .chain(extra_data)
            .chain(nonce)
            .chain(version)
            .chain(timestamp)
            .collect();

        let valid_blockhashes = ValidBlockhashes {
            #[rustfmt::skip]
            announced_blockhash: Hash::from([
                0x5d, 0xdc, 0x31, 0x8c, 0x26, 0x07, 0xdc, 0xcb, 0xf9, 0xf0, 0xd4, 0x77, 0x2d, 0x78, 0x3e, 0x3a,
                0xba, 0x44, 0xf8, 0xfa, 0x30, 0x1f, 0xee, 0x12, 0x52, 0x19, 0x46, 0x9e, 0x56, 0xe7, 0x91, 0x2f,
            ]),
            announced_blockhash_time: 1736898900,
            #[rustfmt::skip]
            valid_blockhash: Hash::from([
                0x5d, 0xdc, 0x31, 0x8c, 0x26, 0x07, 0xdc, 0xcb, 0xf9, 0xf0, 0xd4, 0x77, 0x2d, 0x78, 0x3e, 0x3a,
                0xba, 0x44, 0xf8, 0xfa, 0x30, 0x1f, 0xee, 0x12, 0x52, 0x19, 0x46, 0x9e, 0x56, 0xe7, 0x91, 0x2f,
            ]),
            valid_blockhash_time: 1736899200,
        };

        let proof = ComptokenProof::from_bytes(&data.try_into().unwrap(), &valid_blockhashes);

        #[rustfmt::skip]
        let oracle_hash = Hash::new_from_array([
            0x00, 0x00, 0x00, 0x11, 0x18, 0x61, 0x3d, 0xd7, 0x81, 0xbd, 0x47, 0x1c, 0x89, 0x47, 0x82, 0x20,
            0xd5, 0x54, 0x92, 0x81, 0x5f, 0x1b, 0x50, 0xe1, 0xd3, 0x6b, 0x5c, 0x25, 0xf7, 0xaa, 0x9a, 0x19,
        ]);
        assert_eq!(proof.pubkey, pubkey);
        assert_eq!(proof.hash, oracle_hash);
    }
}
