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
    capacity: u32,
    size_blockhash_1: u32,
    size_blockhash_2: u32,
    //_padding_1: [u8; 4],
    _padding_2: [u8; 16],
    recent_hashes: HashStorageStates,
    proofs: [Hash],
}

impl Drop for HashStorage {
    fn drop(&mut self) {
        self.write_data();
    }
}

impl<'a> TryFrom<&mut [u8]> for &mut HashStorage {
    type Error = ProgramError;

    fn try_from(data: &mut [u8]) -> Result<Self, Self::Error> {
        let capacity = u32::from_be_bytes(data[0..4].try_into().expect("correct size"));
        let size_blockhash_1 = u32::from_be_bytes(data[4..8].try_into().expect("correct size"));
        let size_blockhash_2 = u32::from_be_bytes(data[8..12].try_into().expect("correct size"));
        // if data.len() != <sizeof HashStorage w/ capacity Hashes>
        assert_eq!(
            data.len(),
            96 + (capacity as usize) * HASH_BYTES,
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
            result.capacity = u32::from_be(result.capacity);
            result.size_blockhash_1 = u32::from_be(result.size_blockhash_1);
            result.size_blockhash_2 = u32::from_be(result.size_blockhash_2);
            Ok(result)
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
#[repr(C, u32)]
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
                    self.proofs[self.size_blockhash_1 as usize] = new_proof;
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
                    self.proofs[self.size_blockhash_1 as usize] = new_proof;
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
                        self.proofs[(self.size_blockhash_1 + self.size_blockhash_2) as usize] =
                            self.proofs[self.size_blockhash_1 as usize];
                        self.proofs[self.size_blockhash_1 as usize] = new_proof;
                        self.size_blockhash_1 += 1;
                    } else {
                        // user's recent_blockhash matches the second section (recent_blockhash_2)
                        // grow second region by one.
                        self.proofs[(self.size_blockhash_1 + self.size_blockhash_2) as usize] =
                            new_proof;
                        self.size_blockhash_2 += 1;
                    }
                } else if rh1_is_valid {
                    // State Transition 5
                    // Second region is old. Invalidate the second region.
                    self.size_blockhash_2 = 0;
                    self.proofs[self.size_blockhash_1 as usize] = new_proof;
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
                        self.proofs[i as usize] = self.proofs
                            [(self.size_blockhash_1 + self.size_blockhash_2 - 1 - i) as usize];
                    }
                    self.size_blockhash_1 = self.size_blockhash_2;
                    // now that region 2 is copied to region 1, invalidate region 2
                    self.size_blockhash_2 = 0;

                    // add new proof to region 1
                    self.proofs[self.size_blockhash_1 as usize] = new_proof;
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

        let increase = min(
            self.capacity as usize * HASH_BYTES,
            MAX_PERMITTED_DATA_INCREASE,
        );
        let new_len = self.capacity as usize * HASH_BYTES + increase;
        self.capacity = (new_len / HASH_BYTES) as u32;
        data_account.realloc(new_len, false)?;
        unsafe {
            let self_ptr: *mut Self = *self;
            let data = core::slice::from_raw_parts_mut(
                self_ptr as *mut u8,
                self.capacity as usize * HASH_BYTES + 96,
            );
            self.write_data();
            *self = data.try_into()?;
        }
        Ok(())
    }

    fn check_for_duplicate(&self, new_hash: Hash) {
        assert!(
            !self.proofs[0..(self.size_blockhash_1 + self.size_blockhash_2) as usize]
                .iter()
                .any(|hash| *hash == new_hash),
            "duplicate hash"
        );
    }

    fn write_data(&mut self) {
        self.capacity = self.capacity.to_be();
        self.size_blockhash_1 = self.size_blockhash_1.to_be();
        self.size_blockhash_2 = self.size_blockhash_2.to_be();
    }
}

#[cfg(test)]
mod test {
    use std::{cell::RefCell, rc::Rc};

    use solana_program::{
        account_info::AccountInfo, blake3::HASH_BYTES, hash::Hash, program_error::ProgramError,
        pubkey::Pubkey,
    };

    use crate::{comptoken_generated::COMPTOKEN_ADDRESS, ValidHashes};

    use super::{HashStorage, HashStorageStates};

    #[repr(align(32))]
    #[repr(C)]
    struct AlignedPubkey {
        original_data_len: u32, // realloc accesses this element for AccountInfo.key, so make sure it is defined behavior
        pubkey: Pubkey,
    }

    const ALIGNED_ZERO_PUBKEY: AlignedPubkey = AlignedPubkey {
        original_data_len: 0,
        pubkey: Pubkey::new_from_array([0; 32]),
    };
    const TOKEN: Pubkey = AlignedPubkey {
        original_data_len: 0,
        pubkey: COMPTOKEN_ADDRESS,
    }
    .pubkey;

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

    fn write_data(
        data: &mut [u8],
        capacity: u32,
        size_blockhash_1: u32,
        size_blockhash_2: u32,
        recent_blockhashes: HashStorageStates,
        proofs: &[Hash],
    ) {
        assert!(data.len() >= 96 + proofs.len() * 32);

        let data_ptr = data.as_mut_ptr();
        let capacity_ptr = data_ptr as *mut u32;
        unsafe {
            *capacity_ptr = capacity.to_be();

            let size_blockhash_1_ptr = data_ptr.offset(4) as *mut u32;
            *size_blockhash_1_ptr = size_blockhash_1.to_be();

            let size_blockhash_2_ptr = data_ptr.offset(8) as *mut u32;
            *size_blockhash_2_ptr = size_blockhash_2.to_be();

            let recent_blockhashes_ptr = data_ptr.offset(28) as *mut HashStorageStates;
            *recent_blockhashes_ptr = recent_blockhashes;

            for (i, hash) in proofs.iter().enumerate() {
                let hash_ptr = data_ptr.offset((96 + i * 32) as isize) as *mut Hash;
                *hash_ptr = *hash;
            }
        }
    }

    struct TestValuesInput<'a> {
        data: &'a mut [u8],
        data_size: usize,
        capacity: u32,
        size_blockhash_1: u32,
        size_blockhash_2: u32,
        recent_blockhashes: HashStorageStates,
        proofs: &'a [Hash],
        valid_blockhashes: ValidHashes,
        new_proofs: &'a [(Hash, Hash)], // (recent_hash, proof)
    }

    struct TestValuesOutput<'a> {
        capacity: u32,
        size_blockhash_1: u32,
        size_blockhash_2: u32,
        recent_blockhashes: HashStorageStates,
        proofs: &'a [Hash],
    }

    struct TestValues<'a> {
        inputs: TestValuesInput<'a>,
        outputs: Option<TestValuesOutput<'a>>,
    }

    fn run_test(test_values: TestValues) {
        let mut inputs = test_values.inputs;
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
            hs.capacity as usize,
            hs.proofs.len(),
            "capacity: '{}' should equal hashes.len(): '{}'",
            hs.capacity as usize,
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
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut [0; 128],
                data_size: 128,
                capacity: 1,
                size_blockhash_1: 0,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::TwoHashes(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                proofs: &[],
                valid_blockhashes: ValidHashes::Two(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                new_proofs: &[],
            },
            outputs: Some(TestValuesOutput {
                capacity: 1,
                size_blockhash_1: 0,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::TwoHashes(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                proofs: &[],
            }),
        });
    }

    #[test]
    #[should_panic(expected = "data does not match capacity")]
    fn test_try_from_incorrect_capacity() {
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut [0; 160],
                data_size: 160,
                capacity: 1,
                size_blockhash_1: 0,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::NoHashes,
                proofs: &[],
                valid_blockhashes: ValidHashes::Two(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                new_proofs: &[],
            },
            outputs: None,
        });
    }

    #[test]
    fn test_insert() {
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut [0; 256],
                data_size: 128,
                capacity: 1,
                size_blockhash_1: 0,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::NoHashes,
                proofs: &[],
                valid_blockhashes: ValidHashes::Two(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                new_proofs: &[(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                )],
            },
            outputs: Some(TestValuesOutput {
                capacity: 1,
                size_blockhash_1: 1,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(Hash::new_from_array(
                    [0; HASH_BYTES],
                )),
                proofs: &[Hash::new_from_array([1; HASH_BYTES])],
            }),
        });
    }

    #[test]
    fn test_insert_realloc() {
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut [0; 256],
                data_size: 128,
                capacity: 1,
                size_blockhash_1: 1,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(Hash::new_from_array(
                    [0; HASH_BYTES],
                )),
                proofs: &[Hash::new_from_array([1; HASH_BYTES])],
                valid_blockhashes: ValidHashes::Two(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                new_proofs: &[(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([2; HASH_BYTES]),
                )],
            },
            outputs: Some(TestValuesOutput {
                capacity: 2,
                size_blockhash_1: 2,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(Hash::new_from_array(
                    [0; HASH_BYTES],
                )),
                proofs: &[
                    Hash::new_from_array([1; HASH_BYTES]),
                    Hash::new_from_array([2; HASH_BYTES]),
                ],
            }),
        });
    }

    #[test]
    #[should_panic(expected = "duplicate hash")]
    fn test_insert_duplicate() {
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut [0; 256],
                data_size: 128,
                capacity: 1,
                size_blockhash_1: 1,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(Hash::new_from_array(
                    [0; HASH_BYTES],
                )),
                proofs: &[Hash::new_from_array([1; HASH_BYTES])],
                valid_blockhashes: ValidHashes::Two(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                new_proofs: &[(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                )],
            },
            outputs: None,
        });
    }

    #[test]
    fn test_event_one() {
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut [0; 256],
                data_size: 128,
                capacity: 1,
                size_blockhash_1: 0,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::NoHashes,
                proofs: &[],
                valid_blockhashes: ValidHashes::Two(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                new_proofs: &[(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                )],
            },
            outputs: Some(TestValuesOutput {
                capacity: 1,
                size_blockhash_1: 1,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(Hash::new_from_array(
                    [0; HASH_BYTES],
                )),
                proofs: &[Hash::new_from_array([1; HASH_BYTES])],
            }),
        });
    }

    #[test]
    fn test_event_two() {
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut [0; 256],
                data_size: 160,
                capacity: 2,
                size_blockhash_1: 1,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(Hash::new_from_array(
                    [0; HASH_BYTES],
                )),
                proofs: &[Hash::new_from_array([0; HASH_BYTES])],
                valid_blockhashes: ValidHashes::Two(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                new_proofs: &[(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                )],
            },
            outputs: Some(TestValuesOutput {
                capacity: 2,
                size_blockhash_1: 2,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(Hash::new_from_array(
                    [0; HASH_BYTES],
                )),
                proofs: &[
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ],
            }),
        });
    }

    #[test]
    fn test_event_three() {
        run_test(TestValues {
            inputs: TestValuesInput {
                data: &mut [0; 256],
                data_size: 160,
                capacity: 2,
                size_blockhash_1: 1,
                size_blockhash_2: 0,
                recent_blockhashes: HashStorageStates::OneHash(Hash::new_from_array(
                    [0; HASH_BYTES],
                )),
                proofs: &[Hash::new_from_array([0; HASH_BYTES])],
                valid_blockhashes: ValidHashes::Two(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                new_proofs: &[(
                    Hash::new_from_array([1; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                )],
            },
            outputs: Some(TestValuesOutput {
                capacity: 2,
                size_blockhash_1: 1,
                size_blockhash_2: 1,
                recent_blockhashes: HashStorageStates::TwoHashes(
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ),
                proofs: &[
                    Hash::new_from_array([0; HASH_BYTES]),
                    Hash::new_from_array([1; HASH_BYTES]),
                ],
            }),
        });
    }

    #[test]
    fn test_event_four() {
        // TODO: implement
        todo!()
    }

    #[test]
    fn test_event_five() {
        // TODO: implement
        todo!()
    }

    #[test]
    fn test_event_six() {
        // TODO: implement
        todo!()
    }

    #[test]
    fn test_event_seven() {
        // TODO: implement
        todo!()
    }

    #[test]
    fn test_event_eight() {
        // TODO: implement
        todo!()
    }
}
