
payer
root?
config?
recipient - new account to verify - wallet - how to handle users who wish to use existing accounts? how to handle users who wish to migrate away?
nullifier?
world_id_program
system_program

root_hash [u8; 32]
nullifier_hash [u8;32]
proof [u8; 256]

call verify_groth16_proof:
    program: world_id_program
    accounts: [
        root: PDA(b'Root', root_hash, verification_type),
        config: PDA(b'Config'),
    ]
    data: [
        root_hash: [u8; 32],
        _verification_type: [u8; 1], // "orb"? probably? // 1 for orb only?
        signal_hash: [u8; 32], // hashed recipient's public key [0, ...hash(pubkey)[0..31]] 
        nullifier_hash: [u8; 32],
        external_nullifier_hash: [u8; 32], // from action, must be globally unique, so Compto_UBI_Signup?
        proof: [u8; 256],
    ]
    
``` rust
// ensures the hash is on the elliptic curve for the ZK proofs
fn hash_to_field(val: &[u8]) -> [u8; 32] {
    let hash_result = hash(input).to_bytes();
    let big_int: U256 = U256::from_be_bytes(hash_result);
    let shifted: U256 = big_int >> 8;
    shifted.to_be_bytes()
}

fn app_id_action_to_external_nullifier_hash(app_id: &str, action: &str) -> [u8; 32] {
    let app_hash = hash_to_field(app_id.as_bytes());
    let mut combined = app_hash.to_vec();
    combined.extend_from_slice(action.as_bytes());
    hash_to_field(&combined)
}
```

verify proof doesn't gurantee uniqueness