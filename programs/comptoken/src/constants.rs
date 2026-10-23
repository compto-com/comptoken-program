use anchor_lang::prelude::*;

#[constant]
pub const MINT_DECIMALS: u8 = 2;

#[constant]
#[allow(clippy::inconsistent_digit_grouping)]
pub const MINING_REWARD_AMOUNT: u64 = 100_00; // 100.00 comptokens per proof

#[constant]
pub const STAKED_MINT_SEED: &[u8] = b"staked_mint";

#[constant]
pub const UNSTAKED_MINT_SEED: &[u8] = b"unstaked_mint";

#[constant]
pub const GLOBAL_DATA_SEED: &[u8] = b"global_data";

#[constant]
pub const USER_DATA_SEED: &[u8] = b"user_data";

#[constant]
pub const NULLIFIER_SEED: &[u8] = b"nullifier";

#[constant]
// TODO: this number deserves scrutiny and justification
pub const COMPTOKEN_DISTRIBUTION_MULTIPLIER: u64 = 146_000;

#[constant]
pub const EARLY_ADOPTER_COUNT: u32 = 1_000_000_000;

#[constant]
pub const LIQUIDITY_POOL_PERCENT: f64 = 0.05; // 5% of the daily distribution is sent to the liquidity pool

#[constant]
pub const COMPTOKEN_LIQUIDITY_TOKEN_ACCOUNT_SEED: &[u8] = b"liquidity_COMP";

#[constant]
pub const USDC_LIQUIDITY_TOKEN_ACCOUNT_SEED: &[u8] = b"liquidity_USDC";

#[constant]
#[cfg(feature = "mainnet")]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

#[constant]
#[cfg(feature = "devnet")]
pub const USDC_MINT_ADDRESS: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// index of the zero-fee amm_config in our raydium cp-swap fork that the COMP/USDC pool is created under.
// the swap sizing in add_liquidity assumes a zero trade fee, which is enforced on-chain.
#[constant]
pub const RAYDIUM_AMM_CONFIG_INDEX: u16 = 0;

// add_liquidity only swaps/deposits into the pool when its spot price is within
// LIQUIDITY_MAX_PRICE_DEVIATION_BPS of the pool's TWAP over at least LIQUIDITY_TWAP_MIN_WINDOW_SECONDS.
// this bounds what a sandwich around the (permissionless) instruction can extract.
// the oracle holds at least 25 mins of history when full, so anything longer could potentially block
// if the pool is busy
#[constant]
pub const LIQUIDITY_TWAP_MIN_WINDOW_SECONDS: u64 = 24 * 60;

#[constant]
pub const LIQUIDITY_MAX_PRICE_DEVIATION_BPS: u64 = 200;

// raydium pool PDA: [POOL_SEED, amm_config, token_0_mint, token_1_mint] under the cp-swap program,
// where amm_config = [AMM_CONFIG_SEED, RAYDIUM_AMM_CONFIG_INDEX (be)]. precomputed to avoid an
// on-chain find_program_address; checked by `tests::comp_usdc_pool_address_matches_derivation`.
#[constant]
#[cfg(feature = "mainnet")]
pub const COMP_USDC_POOL_ADDRESS: Pubkey = pubkey!("84Y5S1XNBSwgC8oAcvyBkcvBW3QrnebUvvt7WJXjixgw");

#[constant]
#[cfg(feature = "devnet")]
pub const COMP_USDC_POOL_ADDRESS: Pubkey = pubkey!("2wRw8foEASWECmNLu1aWsEtSr4wfVfWqGXPkqYGU1BcE");

#[constant]
pub const MIN_SUPPLY_LIMIT_AMT: u64 = 1_000_000;

#[constant]
pub const PROOF_DIFFICULTY_NBITS: u32 = 0x180EADD8;

#[constant]
pub const PROOF_DIFFICULTY_NBITS_DEVNET: u32 = 0x1D0EADD8;

#[constant]
// TODO: is there a better name for this?
// this value was chosen by roughly simulating the distribution and choosing a value that reasonably
// paces the distribution towards the end goal without being too aggressive
// TODO: consider moving from floating point to integer arithmetic
pub const ADJUST_FACTOR: f64 = 0.3;

#[constant]
// the target end daily max increase. this value achieves ~25% max increase over the course of a year. this value was chosen by taking
// the USD supply increase per year (~7%), and quadrupling it to allow for periods of larger growth, then rounding to a nicer number.
// TODO: consider moving from floating point to integer arithmetic
pub const END_GOAL_PERCENT_INCREASE: f64 = 0.00061;

pub const SECONDS_IN_A_DAY: i64 = 86400;

#[constant]
pub const ANNOUNCEMENT_INTERVAL: i64 = 60 * 5; // 5 minutes

#[constant]
pub const VERIFICATION_DURATION: i64 = SECONDS_IN_A_DAY * 31; // 1 month (31 days)

#[constant]
pub const WORLD_ID_PROOF_LENGTH: u64 = 256;

pub const WORLD_ID_PROOF_SIZE: usize = 256;

#[constant]
pub const VERIFICATION_TYPE: &[u8; 1] = &[0]; // Query type verification (unsure what this actually means)

#[constant]
#[cfg(feature = "mainnet")]
pub const WORLD_APP_ID: &[u8] = b""; // TODO:;

#[constant]
#[cfg(feature = "devnet")]
pub const WORLD_APP_ID: &[u8] = b"app_6599964a29641e47c6f38c562da0628d"; // staging app id that allows cloud verifications (i.e. not orb based)

#[constant]
pub const WORLD_ACTION: &[u8] = b"verifyhuman";

// signals scope a proof to a specific instruction/account combination, so a proof cannot be
// replayed against a different instruction within world id's proof validity window.
#[constant]
pub const VERIFY_SIGNAL_ACTION: &[u8] = b"verify";

#[constant]
pub const REVERIFY_SIGNAL_ACTION: &[u8] = b"reverify";

#[constant]
pub const UNVERIFY_SIGNAL_ACTION: &[u8] = b"unverify";

// TODO: get correct values for v4

#[constant]
pub const WORLD_ID_V4_ACTION: &[u8] = b"verifyhuman-v4";

#[constant]
pub const WORLD_ID_V4_RP_ID: u64 = 1;

#[constant]
pub const WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN: u64 = 0; // unconstrained. TODO: do we want to constrain this? if so, what value should we use?

#[constant]
pub const WORLD_ID_V4_SESSION_SEED: &[u8] = b"world_id_session";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raydium;

    #[test]
    fn comp_usdc_pool_address_matches_derivation() {
        let (unstaked_mint, _) = Pubkey::find_program_address(&[UNSTAKED_MINT_SEED], &crate::ID);
        let (amm_config, _) = Pubkey::find_program_address(
            &[raydium::constants::AMM_CONFIG_SEED, &RAYDIUM_AMM_CONFIG_INDEX.to_be_bytes()],
            &raydium::ID,
        );
        let (token_0_mint, token_1_mint) = if unstaked_mint < USDC_MINT_ADDRESS {
            (unstaked_mint, USDC_MINT_ADDRESS)
        } else {
            (USDC_MINT_ADDRESS, unstaked_mint)
        };
        let (pool, _) = Pubkey::find_program_address(
            &[
                raydium::constants::POOL_SEED,
                amm_config.as_ref(),
                token_0_mint.as_ref(),
                token_1_mint.as_ref(),
            ],
            &raydium::ID,
        );
        assert_eq!(pool, COMP_USDC_POOL_ADDRESS);
    }
}
