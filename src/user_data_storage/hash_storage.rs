use std::cmp::min;

use solana_program::{
    account_info::AccountInfo,
    blake3::HASH_BYTES,
    entrypoint::{ProgramResult, MAX_PERMITTED_DATA_INCREASE},
    hash::Hash,
    program_error::ProgramError,
};

use crate::ValidHashes;

#[repr(C)]
#[derive(Debug)]
pub struct HashStorage {
    capacity: usize, // this structure assumes usize is 64 bits
    size_blockhash_1: usize,
    size_blockhash_2: usize,
    recent_hashes: HashStorageStates,
    proofs: [Hash],
}

impl<'a> TryFrom<&mut [u8]> for &mut HashStorage {
    type Error = ProgramError;

    fn try_from(data: &mut [u8]) -> Result<Self, Self::Error> {
        let capacity = usize::from_le_bytes(data[0..8].try_into().expect("correct size"));
        let size_blockhash_1 = usize::from_le_bytes(data[8..16].try_into().expect("correct size"));
        let size_blockhash_2 = usize::from_le_bytes(data[16..24].try_into().expect("correct size"));
        // if data.len() != <sizeof HashStorage w/ capacity Hashes>
        assert_eq!(
            data.len(),
            96 + capacity * HASH_BYTES,
            "data does not match capacity"
        );
        assert!(
            size_blockhash_1 + size_blockhash_2 <= capacity,
            "size blockhashes does not match capacity"
        );
        // Safety:
        //
        // capacity corresponds with length
        // size_blockhash_1 and size_blockhash_2 are within possible bounds
        // Hash's are valid with any bit pattern
        let new_len = (data.len() / 32) - 3;
        unsafe {
            let data_hashes =
                core::slice::from_raw_parts_mut(data.as_mut_ptr() as *mut Hash, new_len);
            let result: &mut HashStorage = std::mem::transmute(data_hashes);
            result.capacity = usize::from_le(result.capacity);
            result.size_blockhash_1 = usize::from_le(result.size_blockhash_1);
            result.size_blockhash_2 = usize::from_le(result.size_blockhash_2);
            Ok(result)
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
#[repr(C, usize)]
enum HashStorageStates {
    NoHashes = 0,
    OneHash(Hash) = 1,
    TwoHashes(Hash, Hash) = 2,
}

// Implements a state machine, see documentation/HashStorage.md for more information
// new_hash should already be checked for validity (with exception of duplicate check)
// recent_hash should also be valid, and the same as one of the valid_hashes
// valid_hashes should also be the most updated, from Solana runtime
impl HashStorage {
    // may reallocate, which would invalidate `&mut self`, so takes `mut self: &mut Self`
    pub fn insert(
        self: &mut &mut Self,
        recent_blockhash: &Hash,
        new_proof: Hash,
        valid_hashes: ValidHashes,
        data_account: &AccountInfo,
    ) -> ProgramResult {
        match &self.recent_hashes {
            HashStorageStates::NoHashes => {
                // State Transition 1
                // only called the first time a user submits a hash
                // assumes the storage starts off with some capacity
                // no stored hashes, add the new hash
                self.recent_hashes = HashStorageStates::OneHash(*recent_blockhash);
                self.proofs[0] = new_proof;
                self.size_blockhash_1 = 1;
            }
            HashStorageStates::OneHash(rh) => {
                if !valid_hashes.contains(rh) {
                    // State Transition 2 (implicit) and State Transition 1
                    // If the stored one hash is no longer valid, then replace it with the new valid one
                    self.recent_hashes = HashStorageStates::OneHash(*recent_blockhash);
                    self.proofs[0] = new_proof;
                    self.size_blockhash_1 = 1;
                } else if rh == recent_blockhash {
                    // State Transition 3
                    // If another proof is being added using the same recent_blockhash
                    self.check_for_duplicate(new_proof);
                    self.realloc_if_necessary(data_account)?;
                    self.proofs[self.size_blockhash_1] = new_proof;
                    self.size_blockhash_1 += 1;
                } else {
                    // State Transition 4
                    // If the stored one hash is valid, but not the same as the new hash, then
                    // add the new hash to the second region
                    // TODO: enforce that the old hash (new hash?) is in slot 1
                    self.recent_hashes = HashStorageStates::TwoHashes(*rh, *recent_blockhash);
                    // realloc ordered after updating the state to satisfy the borrow checker
                    // should not matter, for realloc, as it doesn't interact with recent_hashes
                    self.realloc_if_necessary(data_account)?;

                    // region 2 begins at the end of region 1
                    self.proofs[self.size_blockhash_1] = new_proof;
                    self.size_blockhash_2 += 1;
                }
            }
            HashStorageStates::TwoHashes(rh1, rh2) => {
                let rh1_is_valid = valid_hashes.contains(rh1);
                let rh2_is_valid = valid_hashes.contains(&rh2);
                let rh1_is_a_match = rh1 == recent_blockhash;

                if rh1_is_valid && rh2_is_valid {
                    // State Transition 6
                    self.check_for_duplicate(new_proof);
                    self.realloc_if_necessary(data_account)?;
                    if rh1_is_a_match {
                        // user's recent_blockhash matches the first section (recent_blockhash_1)
                        // copy the first hash to the end of the second region to the end of the
                        // second region, to make space for the first region to grow by one.
                        self.proofs[self.size_blockhash_1 + self.size_blockhash_2] =
                            self.proofs[self.size_blockhash_1];
                        self.proofs[self.size_blockhash_1] = new_proof;
                        self.size_blockhash_1 += 1;
                    } else {
                        // user's recent_blockhash matches the second section (recent_blockhash_2)
                        // grow second region by one.
                        self.proofs[self.size_blockhash_1 + self.size_blockhash_2] = new_proof;
                        self.size_blockhash_2 += 1;
                    }
                } else if rh1_is_valid {
                    // State Transition 5
                    // Second region is old. Invalidate the second region.
                    self.size_blockhash_2 = 0;
                    self.proofs[self.size_blockhash_1] = new_proof;
                    if rh1_is_a_match {
                        self.recent_hashes = HashStorageStates::OneHash(*rh1);
                        self.size_blockhash_1 += 1;
                    } else {
                        // State Transition 4
                        // If rh1 is valid but not a match, then begin a new second region
                        self.recent_hashes = HashStorageStates::TwoHashes(*rh1, *recent_blockhash);
                        self.size_blockhash_2 = 1;
                    }
                } else if rh2_is_valid {
                    // State Transition 5
                    // First region is old. Invalidate / replace the first region.
                    // copy region 2 to region 1
                    // to save on unneccessary copying...
                    // copies all of region 2 to region 1 if region 2 is smaller than region 1
                    // copies only size_region_1 from the end of region 2 to region 1
                    // if region 2 is larger than region 1
                    for i in 0..min(self.size_blockhash_1, self.size_blockhash_2) {
                        self.proofs[i] =
                            self.proofs[self.size_blockhash_1 + self.size_blockhash_2 - 1 - i];
                    }
                    self.size_blockhash_1 = self.size_blockhash_2;
                    // now that region 2 is copied to region 1, invalidate region 2
                    self.size_blockhash_2 = 0;

                    // add new proof to region 1
                    self.proofs[self.size_blockhash_1] = new_proof;
                    if rh2 == recent_blockhash {
                        // there is a match, add to region 1 (formerly region 2)
                        self.recent_hashes = HashStorageStates::OneHash(*rh2);
                        self.size_blockhash_1 += 1;
                    } else {
                        // State Transition 4
                        // now that region 2 is copied to region 1, begin a new second region
                        self.recent_hashes = HashStorageStates::TwoHashes(*rh2, *recent_blockhash);
                        self.size_blockhash_2 = 1;
                    }
                } else {
                    // State Transition 5 (implicit), 2 (implicit), 1
                    // If neither recent_hash_1 nor recent_hash_2 are valid, then
                    // invalidate both regions and start over with one proof in the first region
                    self.recent_hashes = HashStorageStates::OneHash(*recent_blockhash);
                    self.proofs[0] = new_proof;
                    self.size_blockhash_1 = 1;
                    self.size_blockhash_2 = 0;
                }
            }
        }
        Ok(())
    }

    // realloc invalidates `&mut self`, so it takes `&mut &mut self` in order to correct this
    fn realloc_if_necessary(self: &mut &mut Self, data_account: &AccountInfo) -> ProgramResult {
        if self.capacity > self.size_blockhash_1 + self.size_blockhash_2 {
            return Ok(());
        }

        let increase = min(self.capacity * HASH_BYTES, MAX_PERMITTED_DATA_INCREASE);
        let new_len = self.capacity * HASH_BYTES + increase;
        self.capacity = new_len / HASH_BYTES;
        data_account.realloc(new_len, false)?;
        unsafe {
            let self_ptr: *mut Self = *self;
            let data = core::slice::from_raw_parts_mut(
                self_ptr as *mut u8,
                self.capacity * HASH_BYTES + 96,
            );
            self.write_data();
            *self = data.try_into()?;
        }
        Ok(())
    }

    fn check_for_duplicate(&self, new_hash: Hash) {
        assert!(
            !self.proofs[0..self.size_blockhash_1 + self.size_blockhash_2]
                .iter()
                .any(|hash| *hash == new_hash),
            "duplicate hash"
        );
    }

    fn write_data(&mut self) {
        self.capacity = self.capacity.to_le();
        self.size_blockhash_1 = self.size_blockhash_1.to_le();
        self.size_blockhash_2 = self.size_blockhash_2.to_le();
    }
}

#[cfg(test)]
mod test {
    use solana_program::{
        account_info::AccountInfo,
        hash::{Hash, HASH_BYTES},
        pubkey::Pubkey,
    };
    use std::{cell::RefCell, rc::Rc};

    use crate::{comptoken_generated::COMPTOKEN_ADDRESS, ValidHashes};

    use super::{HashStorage, HashStorageStates};

    #[repr(C)]
    struct AccountInfoPubkey {
        // the size of the data account on the blockchain.
        // used for checking if the size increase is too much, which shouldn't ever be a concern in our tests
        // We need to add this because solana-program's realloc function takes a reference to the Pubkey and
        // assumes the size of the account is right before the Pubkey.
        // Normally AccountInfo should come from the solana runtime. This is a hack to make the tests work.
        original_data_len: u32,
        pubkey: Pubkey,
    }

    #[repr(align(8))]
    #[repr(C)]
    struct AccountInfoAlignedData<const N: usize> {
        // similar to AccountInfoPubkey, this is a hack to make the tests work.
        // solana-program realloc (specifically  `original_data_len()`) makes assumptions.
        // This satisfies those assumptions for our simulated AccountData.
        data_len: usize,
        data: [u8; N],
    }

    const ALIGNED_ZERO_PUBKEY: AccountInfoPubkey = AccountInfoPubkey {
        original_data_len: 0,
        pubkey: Pubkey::new_from_array([0; HASH_BYTES]),
    };
    const TOKEN: Pubkey = COMPTOKEN_ADDRESS;

    fn create_dummy_data_account<'a>(lamports: &'a mut u64, data: &'a mut [u8]) -> AccountInfo<'a> {
        eprintln!("{:p} ", &ALIGNED_ZERO_PUBKEY);
        AccountInfo {
            key: &ALIGNED_ZERO_PUBKEY.pubkey,
            lamports: Rc::new(RefCell::new(lamports)),
            data: Rc::new(RefCell::new(data)),
            owner: &TOKEN,
            rent_epoch: 0,
            is_signer: false,
            is_writable: true,
            executable: false,
        }
    }

    use hex_literal::hex;

    const POSSIBLE_RECENT_BLOCKHASHES: [Hash; 3] = [
        Hash::new_from_array(hex!(
            "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
        )),
        Hash::new_from_array(hex!(
            "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
        )),
        Hash::new_from_array(hex!(
            "d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35"
        )),
    ];

    const POSSIBLE_NEW_PROOFS: [Hash; 3] = [
        Hash::new_from_array(hex!(
            "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce"
        )),
        Hash::new_from_array(hex!(
            "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
        )),
        Hash::new_from_array(hex!(
            "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d"
        )),
    ];

    #[derive(Debug)]
    struct TestValuesInput<'a> {
        data: &'a mut [u8],
        data_size: usize,
        capacity: usize,
        size_blockhash_1: usize,
        size_blockhash_2: usize,
        recent_blockhashes: HashStorageStates,
        proofs: &'a [Hash],
        valid_blockhashes: ValidHashes<'a>,
        new_proofs: &'a [(Hash, Hash)], // (recent_hash, proof)
    }

    impl<'a> Default for TestValuesInput<'a> {
        fn default() -> Self {
            TestValuesInput {
                data: &mut [],
                data_size: 256,
                capacity: 5,
                size_blockhash_1: 0,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::NoHashes,
                proofs: &[],
                valid_blockhashes: ValidHashes::Two(
                    &POSSIBLE_RECENT_BLOCKHASHES[0],
                    &POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[0], POSSIBLE_NEW_PROOFS[0])],
            }
        }
    }

    #[derive(Debug)]
    struct TestValuesOutput<'a> {
        capacity: usize,
        size_blockhash_1: usize,
        size_blockhash_2: usize,
        recent_blockhashes: HashStorageStates,
        proofs: &'a [Hash],
    }

    impl<'a> Default for TestValuesOutput<'a> {
        fn default() -> Self {
            TestValuesOutput {
                capacity: 5,
                size_blockhash_1: 1,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[0]),
                proofs: &[POSSIBLE_NEW_PROOFS[0]],
            }
        }
    }

    #[derive(Debug, Default)]
    struct TestValues<'a> {
        inputs: TestValuesInput<'a>,
        outputs: Option<TestValuesOutput<'a>>,
    }

    fn write_data(
        data: &mut [u8],
        capacity: usize,
        size_blockhash_1: usize,
        size_blockhash_2: usize,
        recent_blockhashes: HashStorageStates,
        proofs: &[Hash],
    ) {
        assert!(data.len() >= 96 + proofs.len() * 32);

        let data_ptr = data.as_mut_ptr();
        let capacity_ptr = data_ptr as *mut usize;
        unsafe {
            *capacity_ptr = capacity.to_le();

            let size_blockhash_1_ptr = data_ptr.offset(8) as *mut usize;
            *size_blockhash_1_ptr = size_blockhash_1.to_le();

            let size_blockhash_2_ptr = data_ptr.offset(16) as *mut usize;
            *size_blockhash_2_ptr = size_blockhash_2.to_le();

            let recent_blockhashes_ptr = data_ptr.offset(24) as *mut HashStorageStates;
            *recent_blockhashes_ptr = recent_blockhashes;

            for (i, hash) in proofs.iter().enumerate() {
                let hash_ptr = data_ptr.offset((96 + i * 32) as isize) as *mut Hash;
                *hash_ptr = *hash;
            }
        }
    }

    fn run_test(test_values: TestValues) {
        let inputs = test_values.inputs;
        let lamports = &mut 999_999_999u64;
        let mut final_data_size = inputs.data_size;
        while final_data_size < (inputs.new_proofs.len() + inputs.proofs.len()) * 32 + 96 {
            final_data_size += final_data_size;
        }
        if final_data_size > inputs.data.len() {
            panic!(
                "test requires more space than the buffer ({} > {})",
                final_data_size,
                inputs.data.len()
            );
        }

        let data: &mut [u8] =
            unsafe { std::slice::from_raw_parts_mut(inputs.data.as_mut_ptr(), inputs.data_size) };
        write_data(
            data,
            inputs.capacity,
            inputs.size_blockhash_1,
            inputs.size_blockhash_2,
            inputs.recent_blockhashes,
            inputs.proofs,
        );
        let dummy_account = create_dummy_data_account(lamports, data);
        let mut hs: &mut HashStorage = dummy_account
            .try_borrow_mut_data()
            .unwrap()
            .as_mut()
            .try_into()
            .expect("no issues creating HashStorage");

        for (recent_blockhash, proof) in inputs.new_proofs {
            hs.insert(
                recent_blockhash,
                *proof,
                inputs.valid_blockhashes,
                &dummy_account,
            )
            .unwrap();
        }

        let outputs = test_values
            .outputs
            .expect("outputs should be Some if it didn't already panic");

        assert_eq!(
            hs.capacity, outputs.capacity,
            "capacity: '{}' should be {}",
            hs.capacity, outputs.capacity,
        );
        assert_eq!(
            hs.capacity,
            hs.proofs.len(),
            "capacity: '{}' should equal hashes.len(): '{}'",
            hs.capacity,
            hs.proofs.len(),
        );
        assert_eq!(
            hs.size_blockhash_1, outputs.size_blockhash_1,
            "size_blockhash_1 should be {}",
            outputs.size_blockhash_1
        );
        assert_eq!(
            hs.size_blockhash_2, outputs.size_blockhash_2,
            "size_blockhash_2 should be {}",
            outputs.size_blockhash_2
        );

        assert_eq!(
            hs.recent_hashes, outputs.recent_blockhashes,
            "Recent Blockhashes were wrong"
        );
        for (proof, output_proof) in hs.proofs.into_iter().zip(outputs.proofs) {
            assert_eq!(
                proof, output_proof,
                "proof: \'{}\' should equal \'{}\'",
                proof, output_proof
            )
        }
    }

    #[test]
    fn test_try_from_empty_data_account() {
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                new_proofs: &[],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 0,
                recent_blockhashes: HashStorageStates::NoHashes,
                proofs: &[],
                ..Default::default()
            }),
        });
    }

    #[test]
    #[should_panic(expected = "data does not match capacity")]
    fn test_try_from_incorrect_capacity() {
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 160,
            data: [0; 160],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                ..Default::default()
            },
            ..Default::default()
        });
    }

    #[test]
    fn test_insert() {
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                ..Default::default()
            },
            outputs: Some(Default::default()),
        });
    }

    #[test]
    fn test_insert_realloc() {
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 128,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                capacity: 1,
                size_blockhash_1: 1,
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[0]),
                proofs: &[POSSIBLE_NEW_PROOFS[0]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[0], POSSIBLE_NEW_PROOFS[1])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                capacity: 2,
                size_blockhash_1: 2,
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                ..Default::default()
            }),
        });
    }

    #[test]
    #[should_panic(expected = "duplicate hash")]
    fn test_insert_duplicate() {
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[0]),
                proofs: &[POSSIBLE_NEW_PROOFS[0]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[0], POSSIBLE_NEW_PROOFS[0])],
                ..Default::default()
            },
            ..Default::default()
        });
    }

    #[test]
    // No recent_hashes -> One recent_hash
    fn test_event_one() {
        // identical to insert
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                valid_blockhashes: ValidHashes::One(&POSSIBLE_RECENT_BLOCKHASHES[0]),
                recent_blockhashes: HashStorageStates::NoHashes,
                proofs: &[],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[0], POSSIBLE_NEW_PROOFS[0])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 1,
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[0]),
                proofs: &[POSSIBLE_NEW_PROOFS[0]],
                ..Default::default()
            }),
        });
    }

    #[test]
    // One recent_hash -> Same recent_hash
    fn test_event_two() {
        // also covered by realloc
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                valid_blockhashes: ValidHashes::One(&POSSIBLE_RECENT_BLOCKHASHES[0]),
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[0]),
                proofs: &[POSSIBLE_NEW_PROOFS[0]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[0], POSSIBLE_NEW_PROOFS[1])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 2,
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[0]),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                ..Default::default()
            }),
        });
    }

    #[test]
    // One recent_hash -> Two recent_hashes
    fn test_event_three() {
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                valid_blockhashes: ValidHashes::Two(
                    &POSSIBLE_RECENT_BLOCKHASHES[0],
                    &POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[0]),
                proofs: &[POSSIBLE_NEW_PROOFS[0]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[1], POSSIBLE_NEW_PROOFS[1])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                ..Default::default()
            }),
        });
    }

    #[test]
    // One recent_hash -> New recent_hash
    fn test_event_four() {
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                valid_blockhashes: ValidHashes::One(&POSSIBLE_RECENT_BLOCKHASHES[1]),
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[0]),
                proofs: &[POSSIBLE_NEW_PROOFS[0]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[1], POSSIBLE_NEW_PROOFS[1])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 1,
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[1]),
                proofs: &[POSSIBLE_NEW_PROOFS[1]],
                ..Default::default()
            }),
        });
    }

    #[test]
    // Two recent_hashes -> Same two recent_hashes
    fn test_event_five() {
        // tests the first region
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                valid_blockhashes: ValidHashes::Two(
                    &POSSIBLE_RECENT_BLOCKHASHES[0],
                    &POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[0], POSSIBLE_NEW_PROOFS[2])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 2,
                size_blockhash_2: 1,
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                proofs: &[
                    POSSIBLE_NEW_PROOFS[0],
                    POSSIBLE_NEW_PROOFS[2],
                    POSSIBLE_NEW_PROOFS[1],
                ],
                ..Default::default()
            }),
        });
    }

    #[test]
    fn test_event_five_alt() {
        // tests the second region
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                valid_blockhashes: ValidHashes::Two(
                    &POSSIBLE_RECENT_BLOCKHASHES[0],
                    &POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[1], POSSIBLE_NEW_PROOFS[2])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 1,
                size_blockhash_2: 2,
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                proofs: &[
                    POSSIBLE_NEW_PROOFS[0],
                    POSSIBLE_NEW_PROOFS[1],
                    POSSIBLE_NEW_PROOFS[2],
                ],
                ..Default::default()
            }),
        });
    }

    #[test]
    // Two recent_hashes -> Only the less old recent_hash is valid
    fn test_event_six() {
        // checks region 1
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                valid_blockhashes: ValidHashes::One(&POSSIBLE_RECENT_BLOCKHASHES[1]),
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[1], POSSIBLE_NEW_PROOFS[2])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 2,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[1]),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[2]],
                ..Default::default()
            }),
        });
    }

    #[test]
    fn test_event_six_alt() {
        // checks region 2
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                valid_blockhashes: ValidHashes::One(&POSSIBLE_RECENT_BLOCKHASHES[1]),
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[1], POSSIBLE_NEW_PROOFS[2])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 2,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[1]),
                proofs: &[POSSIBLE_NEW_PROOFS[1], POSSIBLE_NEW_PROOFS[2]],
                ..Default::default()
            }),
        });
    }

    #[test]
    // Two recent_hashes -> The less old recent_hash + new recent_hash
    fn test_event_seven() {
        // checks region 1
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                valid_blockhashes: ValidHashes::Two(
                    &POSSIBLE_RECENT_BLOCKHASHES[1],
                    &POSSIBLE_RECENT_BLOCKHASHES[2],
                ),
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[2], POSSIBLE_NEW_PROOFS[2])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                    POSSIBLE_RECENT_BLOCKHASHES[2],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[1], POSSIBLE_NEW_PROOFS[2]],
                ..Default::default()
            }),
        });
    }

    #[test]
    fn test_event_seven_alt() {
        // checks region 2
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                valid_blockhashes: ValidHashes::Two(
                    &POSSIBLE_RECENT_BLOCKHASHES[1],
                    &POSSIBLE_RECENT_BLOCKHASHES[2],
                ),
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[2], POSSIBLE_NEW_PROOFS[2])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                    POSSIBLE_RECENT_BLOCKHASHES[2],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[2]],
                ..Default::default()
            }),
        });
    }

    #[test]
    // Two recent_hashes -> New recent_hash
    fn test_event_eight() {
        let mut aligned_data = AccountInfoAlignedData {
            data_len: 256,
            data: [0; 256],
        };
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut aligned_data.data,
                data_size: aligned_data.data_len,
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                valid_blockhashes: ValidHashes::One(&POSSIBLE_RECENT_BLOCKHASHES[2]),
                recent_blockhashes: HashStorageStates::TwoHashes(
                    POSSIBLE_RECENT_BLOCKHASHES[0],
                    POSSIBLE_RECENT_BLOCKHASHES[1],
                ),
                proofs: &[POSSIBLE_NEW_PROOFS[0], POSSIBLE_NEW_PROOFS[1]],
                new_proofs: &[(POSSIBLE_RECENT_BLOCKHASHES[2], POSSIBLE_NEW_PROOFS[2])],
                ..Default::default()
            },
            outputs: Some(TestValuesOutput {
                size_blockhash_1: 1,
                recent_blockhashes: HashStorageStates::OneHash(POSSIBLE_RECENT_BLOCKHASHES[2]),
                proofs: &[POSSIBLE_NEW_PROOFS[2]],
                ..Default::default()
            }),
        });
    }
}
