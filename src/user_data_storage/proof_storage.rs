use spl_token_2022::solana_program::{hash::Hash, hash::HASH_BYTES, program_error::ProgramError};

#[repr(C)]
#[derive(Debug)]
pub struct ProofStorageBase<T: ?Sized> {
    // capacity is stored in the fat pointer
    length: usize,
    blockhash: Hash,
    proofs: T,
}

// MAGIC NUMBER: CHANGE NEEDS TO BE REFLECTED IN test_client.js
pub const PROOF_STORAGE_MIN_SIZE: usize = std::mem::size_of::<ProofStorageBase<Hash>>();

pub type ProofStorage = ProofStorageBase<[Hash]>;

impl ProofStorage {
    pub fn insert(&mut self, new_proof: &Hash, new_blockhash: &Hash) {
        // new_proof and new_blockhash have already been verified
        if self.blockhash != *new_blockhash {
            self.blockhash = *new_blockhash;
            self.length = 0;
        }
        assert!(!self.contains(new_proof), "proof should be new");

        match self.proofs.get_mut(self.length) {
            // If proofs is not full, write the new proof into the next slot
            Some(proof) => *proof = *new_proof,
            None => panic!("User Data Account not large enough, consider reallocing"),
        }
        self.length += 1;
    }

    fn contains(&self, new_proof: &Hash) -> bool {
        self.into_iter().any(|proof| proof == new_proof)
    }
}

impl TryFrom<&mut [u8]> for &mut ProofStorage {
    type Error = ProgramError;

    fn try_from(data: &mut [u8]) -> Result<Self, Self::Error> {
        assert!(data.len() >= PROOF_STORAGE_MIN_SIZE);
        assert!((data.len() - PROOF_STORAGE_MIN_SIZE) % HASH_BYTES == 0);

        let capacity = ((data.len() - PROOF_STORAGE_MIN_SIZE) / HASH_BYTES) + 1;
        // Two step process to dynamically create ProofStorage from the account data array of bytes
        // Step 1: Create a slice from the account data array of bytes, so the wide pointer extra capacity
        // field is correct after step 2
        // This slice is not a strictly accurate representation of the data, since the size is incorrect,
        // but step 2 will correct this
        let data_hashes =
            unsafe { std::slice::from_raw_parts_mut(data.as_mut_ptr() as *mut _, capacity) };
        // Step 2: Create a ProofStorage from the slice
        // the chaining of `as` first converts a reference to a pointer, and then converts the pointer to a *ProofStorage* pointer
        // Then we convert the ProofStorage pointer to a mutable reference to a ProofStorage
        // This is how the rust docs say to do it... :/
        // https://doc.rust-lang.org/std/mem/fn.transmute.html
        let result = unsafe { &mut *(data_hashes as *mut _ as *mut ProofStorage) };
        assert!(result.length <= result.proofs.len());
        Ok(result)
    }
}

pub struct HashIter<'a> {
    iter: std::iter::Take<std::slice::Iter<'a, Hash>>,
}

impl<'a> Iterator for HashIter<'a> {
    type Item = &'a Hash;

    fn next(&mut self) -> Option<Self::Item> {
        self.iter.next()
    }
}

pub struct MutHashIter<'a> {
    iter: std::iter::Take<std::slice::IterMut<'a, Hash>>,
}

impl<'a> Iterator for MutHashIter<'a> {
    type Item = &'a mut Hash;

    fn next(&mut self) -> Option<Self::Item> {
        self.iter.next()
    }
}

impl<'a> IntoIterator for &'a ProofStorage {
    type Item = &'a Hash;
    type IntoIter = HashIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        HashIter {
            iter: self.proofs.into_iter().take(self.length),
        }
    }
}

impl<'a> IntoIterator for &'a mut ProofStorage {
    type Item = &'a mut Hash;
    type IntoIter = MutHashIter<'a>;

    fn into_iter(self) -> Self::IntoIter {
        MutHashIter {
            iter: self.proofs.iter_mut().take(self.length),
        }
    }
}

#[cfg(test)]
mod test {

    use super::*;
    use hex_literal::hex;
    use std::cmp::max;

    #[derive(Debug)]
    struct ProofAndBlockhash {
        proof: Hash,
        blockhash: Hash,
    }

    #[derive(Debug)]
    struct TestValuesInput<'a> {
        data: &'a mut [u8],
        length: usize,
        stored_blockhash: Hash,
        proofs: &'a [Hash],
        new_proofs: &'a [ProofAndBlockhash],
    }

    #[derive(Debug)]
    struct TestValuesOutput<'a> {
        length: usize,
        stored_blockhash: Hash,
        proofs: &'a [Hash],
    }

    struct TestValues<'a> {
        input: TestValuesInput<'a>,
        output: Option<TestValuesOutput<'a>>,
    }

    const POSSIBLE_BLOCKHASHES: [Hash; 2] = [
        Hash::new_from_array(hex!(
            "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
        )),
        Hash::new_from_array(hex!(
            "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
        )),
    ];

    const POSSIBLE_PROOFS: [Hash; 2] = [
        Hash::new_from_array(hex!(
            "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce"
        )),
        Hash::new_from_array(hex!(
            "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
        )),
    ];

    /// # SAFETY
    ///
    /// data must be large enough to hold a ProofStorage of length proofs.len()
    unsafe fn write_data(data: &mut [u8], length: usize, blockhash: &Hash, proofs: &[Hash]) {
        let len_ptr = data.as_mut_ptr() as *mut usize;
        *len_ptr = length;

        let blockhash_ptr = data.as_mut_ptr().offset(8) as *mut Hash;
        *blockhash_ptr = *blockhash;

        for (i, proof) in proofs.iter().enumerate() {
            let proof_ptr = data.as_mut_ptr().offset((40 + i * HASH_BYTES) as isize) as *mut Hash;
            *proof_ptr = *proof;
        }
    }

    fn run_test(test_values: TestValues) {
        let input = test_values.input;
        let output = test_values.output;
        let max_length = max(input.length, output.as_ref().map_or(0, |o| o.length));
        assert!(
            input.data.len() >= PROOF_STORAGE_MIN_SIZE + (max_length - 1) * HASH_BYTES,
            "input data len is not large enough for the test"
        );

        unsafe {
            write_data(
                input.data,
                input.length,
                &input.stored_blockhash,
                input.proofs,
            )
        }

        let proof_storage: &mut ProofStorage =
            input.data.try_into().expect("panicked already if failed");

        for pow in input.new_proofs {
            proof_storage.insert(&pow.proof, &pow.blockhash);
        }

        let proof_storage: &ProofStorage = &proof_storage;
        let output = output.expect("panicked already if not Some");

        assert_eq!(
            proof_storage.length, output.length,
            "hash_storage is the correct length"
        );
        assert_eq!(
            proof_storage.blockhash, output.stored_blockhash,
            "hash_storage has the correct blockhash stored"
        );
        proof_storage
            .into_iter()
            .zip(output.proofs)
            .for_each(|(proof, expected_proof)| assert_eq!(proof, expected_proof))
    }

    #[test]
    fn test_try_from() {
        run_test(TestValues {
            input: TestValuesInput {
                data: &mut [0_u8; PROOF_STORAGE_MIN_SIZE],
                length: 1,
                stored_blockhash: POSSIBLE_BLOCKHASHES[0],
                proofs: &[POSSIBLE_PROOFS[0]],
                new_proofs: &[],
            },
            output: Some(TestValuesOutput {
                length: 1,
                stored_blockhash: POSSIBLE_BLOCKHASHES[0],
                proofs: &[POSSIBLE_PROOFS[0]],
            }),
        })
    }

    #[test]
    fn test_insert() {
        run_test(TestValues {
            input: TestValuesInput {
                data: &mut [0_u8; PROOF_STORAGE_MIN_SIZE],
                length: 0,
                stored_blockhash: POSSIBLE_BLOCKHASHES[0],
                proofs: &[],
                new_proofs: &[ProofAndBlockhash {
                    proof: POSSIBLE_PROOFS[0],
                    blockhash: POSSIBLE_BLOCKHASHES[0],
                }],
            },
            output: Some(TestValuesOutput {
                length: 1,
                stored_blockhash: POSSIBLE_BLOCKHASHES[0],
                proofs: &[POSSIBLE_PROOFS[0]],
            }),
        })
    }

    #[test]
    fn test_insert_new() {
        run_test(TestValues {
            input: TestValuesInput {
                data: &mut [0_u8; PROOF_STORAGE_MIN_SIZE],
                length: 1,
                stored_blockhash: POSSIBLE_BLOCKHASHES[0],
                proofs: &[POSSIBLE_PROOFS[0]],
                new_proofs: &[ProofAndBlockhash {
                    proof: POSSIBLE_PROOFS[1],
                    blockhash: POSSIBLE_BLOCKHASHES[1],
                }],
            },
            output: Some(TestValuesOutput {
                length: 1,
                stored_blockhash: POSSIBLE_BLOCKHASHES[1],
                proofs: &[POSSIBLE_PROOFS[1]],
            }),
        })
    }

    #[test]
    #[should_panic(expected = "proof should be new")]
    fn test_insert_duplicate() {
        run_test(TestValues {
            input: TestValuesInput {
                // size is 1 proof bigger than it needs to be so that we can test the duplicate
                // failure case specifically and not worry about getting an out-of-size error.
                data: &mut [0_u8; PROOF_STORAGE_MIN_SIZE + 1 * HASH_BYTES],
                length: 1,
                stored_blockhash: POSSIBLE_BLOCKHASHES[0],
                proofs: &[POSSIBLE_PROOFS[0]],
                new_proofs: &[ProofAndBlockhash {
                    proof: POSSIBLE_PROOFS[0],
                    blockhash: POSSIBLE_BLOCKHASHES[0],
                }],
            },
            output: None,
        })
    }
}
