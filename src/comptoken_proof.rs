use std::mem;

use spl_token_2022::solana_program::{
    hash::{Hash, Hasher, HASH_BYTES},
    pubkey::Pubkey,
};

use crate::global_data::ValidBlockhashes;

// ensure this remains consistent with comptoken_proof.js
const MIN_NUM_ZEROED_BITS: u32 = 3; // TODO: replace with permanent value

pub fn verify_proof(proof: &ComptokenProof, valid_blockhashes: &ValidBlockhashes) -> bool {
    let leading_zeros: bool = ComptokenProof::leading_zeroes(&proof.hash) >= MIN_NUM_ZEROED_BITS;
    let recent_blockhash: bool = proof.recent_block_hash == valid_blockhashes.valid_blockhash;
    let equal_hash: bool = proof.generate_hash() == proof.hash;
    let valid_hash_is_fresh: bool = !valid_blockhashes.is_valid_blockhash_stale();
    // hash duplicate check is part of inserting
    return leading_zeros && recent_blockhash && equal_hash && valid_hash_is_fresh;
}

pub const VERIFY_DATA_SIZE: usize = HASH_BYTES + mem::size_of::<u64>() + HASH_BYTES;

// Ensure changes to this struct remain consistent with comptoken_proof.js
#[derive(Debug)]
pub struct ComptokenProof<'a> {
    pub pubkey: &'a Pubkey,
    pub recent_block_hash: Hash,
    pub nonce: u64,
    pub hash: Hash,
}

impl<'a> ComptokenProof<'a> {
    pub fn from_bytes(key: &'a Pubkey, bytes: &[u8; VERIFY_DATA_SIZE]) -> Self {
        // ensure this remains consistent with comptoken_proof.js
        let range_1 = 0..HASH_BYTES;
        let range_2 = range_1.end..range_1.end + mem::size_of::<u64>();
        let range_3 = range_2.end..range_2.end + HASH_BYTES;

        let recent_block_hash = Hash::new_from_array(bytes[range_1].try_into().unwrap());
        // this nonce is what the miner incremented to find a valid proof
        let nonce = u64::from_le_bytes(bytes[range_2].try_into().unwrap());
        let hash = Hash::new_from_array(bytes[range_3].try_into().unwrap());

        ComptokenProof { pubkey: key, recent_block_hash, nonce, hash }
    }

    pub fn leading_zeroes(hash: &Hash) -> u32 {
        let mut leading_zeroes: u32 = 0;
        for byte in hash.to_bytes() {
            if byte == 0 {
                leading_zeroes += 8;
            } else {
                let mut mask = 0x80;
                while mask > 0 && (mask & byte) == 0 {
                    leading_zeroes += 1;
                    mask >>= 1;
                }
                break;
            }
        }
        leading_zeroes
    }

    pub fn generate_hash(&self) -> Hash {
        // ensure this remains consistent with comptoken_proof.js
        let mut hasher = Hasher::default();
        hasher.hash(&self.pubkey.to_bytes());
        hasher.hash(&self.recent_block_hash.to_bytes());
        hasher.hash(&self.nonce.to_le_bytes());
        hasher.result()
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
