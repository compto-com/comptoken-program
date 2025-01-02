// store the nullifiers of the world id verification process to prevent a user from verifying twice
use comptoken_utils::verify_accounts::VerifiedAccountInfo;
use solana_program::{hash::Hash, pubkey::Pubkey};

#[repr(align(32))]
struct WorldIdNullifiersMeta {
    size: usize,
    _padding: [u8; 24],
}

pub struct WorldIdNullifiers {
    meta: WorldIdNullifiersMeta,
    nullifiers: [Hash; Self::SIZE],
}

impl WorldIdNullifiers {
    const SIZE: usize = 10_240 - std::mem::size_of::<WorldIdNullifiersMeta>() / std::mem::size_of::<Hash>(); // 10_240 is the max size of an account on Solana (is there overhead (i.e. owner, executable, lamports) that needs to be accounted for?)

    /// # Safety
    ///
    /// The caller must ensure that the account is actually a valid WorldIdNullifiers
    pub fn from_verified_account<'a>(account: &VerifiedAccountInfo<'a>) -> &'a Self {
        let data = account.try_borrow_data().unwrap();
        data.as_ref().into()
    }

    /// # Safety
    ///
    /// The caller must ensure that the account is actually a valid WorldIdNullifiers
    pub fn from_verified_account_mut<'a>(account: &mut VerifiedAccountInfo<'a>) -> &'a mut Self {
        let mut data = account.try_borrow_mut_data().unwrap();
        data.as_mut().into()
    }

    /// Get the seeds that should be used to derive the account
    fn get_seeds(nullifier: &Hash) -> Vec<&[u8]> {
        vec![b"NullifierStorage_1", &nullifier.as_ref()[..4]] // TODO: are these the correct seeds?
    }

    /// Get the account that should be used to store the nullifier
    ///
    /// The account should be a PDA with seeds that are derived from the nullifier
    /// (TODO: should it be a single account or a list of accounts?)
    pub fn get_account(program_id: &Pubkey, nullifier: &Hash) -> Pubkey {
        Pubkey::find_program_address(&Self::get_seeds(nullifier), program_id).0
    }

    /// Insert a nullifier into the list, return None if the nullifier already exists
    pub fn insert(&mut self, nullifier: &Hash) -> Option<()> {
        // TODO: better way to insert nullifiers/ check if nullifier already exists
        if self.nullifiers.iter().take(self.meta.size).any(|n| n == nullifier) {
            None
        } else {
            if self.meta.size == Self::SIZE {
                // TODO: make this not possible/handle this case
                panic!("WorldIdNullifiers is full");
            }
            self.nullifiers[self.meta.size] = *nullifier;
            self.meta.size += 1;
            Some(())
        }
    }
}

impl From<&[u8]> for &WorldIdNullifiers {
    /// # Safety
    ///
    /// The caller must ensure that the data is actually a valid WorldIdNullifiers
    fn from(data: &[u8]) -> Self {
        assert!(data.len() == std::mem::size_of::<Self>());
        unsafe { &*(data.as_ptr().cast()) }
    }
}

impl From<&mut [u8]> for &mut WorldIdNullifiers {
    /// # Safety
    ///
    /// The caller must ensure that the data is actually a valid WorldIdNullifiers
    fn from(data: &mut [u8]) -> Self {
        assert!(data.len() == std::mem::size_of::<Self>());
        unsafe { &mut *(data.as_mut_ptr().cast()) }
    }
}
