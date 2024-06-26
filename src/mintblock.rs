use std::mem;

use solana_program::{
    hash::{Hash, Hasher, HASH_BYTES},
    pubkey::{Pubkey, PUBKEY_BYTES},
};

const MIN_NUM_ZEROED_BITS: u32 = 1; // TODO: replace with permanent value

// will need to be converted to a data account
static RECENT_BLOCKHASHES: [Hash; 4] = [unsafe { std::mem::transmute([0u8; 32]) }; 4];

fn check_if_recent_blockhashes(hash: &Hash) -> bool {
    // TODO: get it to actually work
    RECENT_BLOCKHASHES.contains(&hash)
}

fn check_if_is_new_hash(hash: Hash) -> bool {
    // TODO: implement
    true
}

pub fn verify_proof(block: ComptokenProof) -> bool {
    ComptokenProof::leading_zeroes(&block.hash) >= MIN_NUM_ZEROED_BITS
        && check_if_recent_blockhashes(&block.recent_block_hash)
        && check_if_is_new_hash(block.hash)
        && block.generate_hash() == block.hash
}
pub struct ComptokenProof<'a> {
    pubkey: &'a Pubkey,
    recent_block_hash: Hash,
    nonce: u64,
    hash: Hash,
}

pub const VERIFY_DATA_SIZE: usize =
    mem::size_of::<Hash>() + mem::size_of::<u64>() + mem::size_of::<Hash>();

impl<'a> ComptokenProof<'a> {
    pub const PUBLIC_KEY_SIZE: usize = PUBKEY_BYTES;

    pub fn from_bytes(key: &'a Pubkey, bytes: &[u8; VERIFY_DATA_SIZE]) -> Self {
        let range_1 = 0..mem::size_of::<Hash>();
        let range_2 = range_1.end..range_1.end + mem::size_of::<u64>();
        let range_3 = range_2.end..range_2.end + mem::size_of::<Hash>();

        let recent_block_hash = Hash::new_from_array(bytes[range_1].try_into().unwrap());
        // this nonce is what the miner incremented to find a valid proof
        let nonce = u64::from_be_bytes(bytes[range_2].try_into().unwrap());
        let hash = Hash::new_from_array(bytes[range_3].try_into().unwrap());

        ComptokenProof {
            pubkey: key,
            recent_block_hash,
            nonce,
            hash,
        }
    }

    pub fn leading_zeroes(hash: &Hash) -> u32 {
        let mut leading_zeroes: u32 = 0;
        let mut iter = hash
            .to_bytes()
            .into_iter()
            .map(|byte| byte.leading_zeros() as u32);
        while let Some(i) = iter.next() {
            leading_zeroes += i;
            if i != 8 {
                break;
            }
        }
        leading_zeroes
    }

    pub fn generate_hash(&self) -> Hash {
        let mut hasher = Hasher::default();
        hasher.hash(&self.pubkey.to_bytes());
        hasher.hash(&self.recent_block_hash.to_bytes());
        hasher.hash(&self.nonce.to_be_bytes());
        hasher.result()
    }
}

#[cfg(test)]
mod test {

    use super::*;

    const ZERO_PUBKEY: Pubkey = Pubkey::new_from_array([0; ComptokenProof::PUBLIC_KEY_SIZE]);

    fn create_arbitrary_block(
        pubkey: &Pubkey,
        recent_block_hash: Hash,
        nonce: u64,
        hash: Hash,
    ) -> ComptokenProof {
        ComptokenProof {
            recent_block_hash,
            pubkey,
            nonce,
            hash,
        }
    }

    fn mine(block: &mut ComptokenProof) {
        while ComptokenProof::leading_zeroes(&block.hash) < MIN_NUM_ZEROED_BITS {
            block.nonce += 1;
            block.hash = block.generate_hash();
        }
    }

    fn create_zero_block() -> ComptokenProof<'static> {
        create_arbitrary_block(
            &ZERO_PUBKEY,
            Hash::new_from_array([0; 32]),
            0,
            Hash::new_from_array([0; 32]),
        )
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
        assert_eq!(
            ComptokenProof::from_bytes(&ZERO_PUBKEY, &[0; VERIFY_DATA_SIZE]).hash,
            [0; 32].into()
        );

        let recent_hash = Hash::new_from_array([1; 32]);
        let pubkey = Pubkey::new_from_array([2; ComptokenProof::PUBLIC_KEY_SIZE]);
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
        assert_eq!(
            block_from_bytes.pubkey, block_from_data.pubkey,
            "pubkeys are different"
        );
        assert_eq!(
            block_from_bytes.nonce, block_from_data.nonce,
            "nonces are different"
        );
        assert_eq!(
            block_from_bytes.hash, block_from_data.hash,
            "hashes are different"
        );
    }
}
