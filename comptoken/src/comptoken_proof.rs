use std::mem;

use spl_token_2022::solana_program::{
    hash::{Hash, Hasher, HASH_BYTES},
    pubkey::Pubkey,
};

use comptoken_utils::verify_accounts::VerifiedAccountInfo;

use crate::global_data::valid_blockhashes::ValidBlockhashes;

// ensure this remains consistent with comptoken_proof.js
const MIN_NUM_ZEROED_BITS: u32 = 3; // TODO: replace with permanent value

pub const VERIFY_DATA_SIZE: usize = HASH_BYTES + mem::size_of::<u64>() + HASH_BYTES;

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
    pub fn from_bytes(data: &[u8], valid_blockhashes: &ValidBlockhashes) -> Result<Self, &'static str> {
        if data.len() != 76 {
            return Err("Invalid byte slice length");
        }

        let pubkey_bytes: [u8; 32] = data[0..32].try_into().map_err(|_| "Failed to parse pubkey")?;
        let extra_data: [u8; 32] = data[32..64].try_into().map_err(|_| "Failed to parse extra_data")?;
        let nonce: [u8; 4] = data[64..68].try_into().map_err(|_| "Failed to parse nonce")?;
        let version: [u8; 4] = data[68..72].try_into().map_err(|_| "Failed to parse version")?;
        let timestamp: [u8; 4] = data[72..76].try_into().map_err(|_| "Failed to parse timestamp")?; 
        
        let mut merkleroot_hasher = Hasher::default();
        
        merkleroot_hasher.hash(&extra_data);
        merkleroot_hasher.hash(&pubkey_bytes);
        let merkleroot_hash1 = merkleroot_hasher.result();
        merkleroot_hasher = Hasher::default();
        merkleroot_hasher.hash(&merkleroot_hash1.to_bytes());
        let merkleroot_hash2 = merkleroot_hasher.result();
        let mut hasher = Hasher::default(); 
        hasher.hash(&version);
        hasher.hash(&valid_blockhashes.valid_blockhash.to_bytes());
        hasher.hash(&merkleroot_hash2.to_bytes());
        hasher.hash(&timestamp);
        hasher.hash(&nonce);
        hasher.hash(&nonce);
        let hash1 = hasher.result();
        hasher = Hasher::default();
        hasher.hash(&hash1.to_bytes());
        let hash2 = hasher.result();
        let pubkey = Pubkey::new_from_array(pubkey_bytes);

        Ok(Self {
            pubkey: pubkey,
            hash: hash2,
        })
    }

    pub fn is_hash_lower_than_target(hash: &Hash) -> bool {
        // The target is 0x0eadd8000000000000000000000000000000000000000000
        // Represent it as a byte array for comparison
        let target_bytes: [u8; 32] = [
            0x0e, 0xad, 0xd8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ];
        // Get the byte array from the hash
        let hash_bytes = hash.to_bytes();
        // Compare the hash byte array to the target byte array
        // This will compare the arrays lexicographically (byte by byte)
        hash_bytes < target_bytes
    }

    // pub fn generate_hash(&self) -> Hash {
    //     // ensure this remains consistent with comptoken_proof.js
    //     let mut hasher = Hasher::default();
    //     hasher.hash(&self.pubkey.to_bytes());
    //     hasher.hash(&self.recent_block_hash.to_bytes());
    //     hasher.hash(&self.nonce.to_le_bytes());
    //     hasher.result()
    // }

    pub fn verify_submitted_proof(
        comptoken_wallet: &VerifiedAccountInfo, data: &[u8], valid_blockhashes: &ValidBlockhashes,
    ) -> Self {
        let proof_result = ComptokenProof::from_bytes(data, valid_blockhashes);
        // let hash = proof.generate_hash();
        let proof = proof_result.expect("invalid proof");
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

    fn create_arbitrary_block(pubkey: &Pubkey, recent_block_hash: Hash, nonce: u64, hash: Hash) -> ComptokenProof {
        ComptokenProof { pubkey, recent_block_hash, nonce, hash }
    }

    #[test]
    fn test_leading_zeroes() {
        let mut hash_array = [0; 32];
        let mut hash = Hash::new_from_array(hash_array);
        assert_eq!(256, ComptokenProof::leading_zeroes(&hash));

        hash_array[0] = 0b1000_0000;
        hash = Hash::new_from_array(hash_array);
        assert_eq!(0, ComptokenProof::leading_zeroes(&hash));

        hash_array[0] = 0b0000_1000;
        hash = Hash::new_from_array(hash_array);
        assert_eq!(4, ComptokenProof::leading_zeroes(&hash));
    }

    #[test]
    fn test_from_bytes() {
        assert_eq!(ComptokenProof::from_bytes(&ZERO_PUBKEY, &[0; VERIFY_DATA_SIZE]).hash, [0; 32].into());

        let recent_hash = Hash::new_from_array([1; 32]);
        let pubkey = Pubkey::new_from_array([2; PUBKEY_BYTES]);
        let nonce: u64 = 0x03030303_03030303;
        let mut v = Vec::<u8>::with_capacity(VERIFY_DATA_SIZE);
        let mut hasher = Hasher::default();

        hasher.hash(&pubkey.to_bytes());
        v.extend(recent_hash.to_bytes());
        v.extend(nonce.to_be_bytes());
        hasher.hash(&v);
        let hash = hasher.result();
        v.extend(hash.to_bytes());

        let bytes = v.try_into().unwrap();
        let block_from_bytes = ComptokenProof::from_bytes(&pubkey, &bytes);
        let block_from_data = create_arbitrary_block(&pubkey, recent_hash, nonce, hash);
        assert_eq!(
            block_from_bytes.recent_block_hash, block_from_data.recent_block_hash,
            "recent_block_hashes are different"
        );
        assert_eq!(block_from_bytes.pubkey, block_from_data.pubkey, "pubkeys are different");
        assert_eq!(block_from_bytes.nonce, block_from_data.nonce, "nonces are different");
        assert_eq!(block_from_bytes.hash, block_from_data.hash, "hashes are different");
    }
}
