# Build

`cargo build-sbf`

# Local Environment

## Dependencies

`apt install python3`  
Install rust and the solana CLI (see docs: https://solana.com/tr/developers/guides/getstarted/setup-local-development)  

# Testing

Start the test server: `solana-test-validator`  
`python3 test/full_deploy_test.py`


# Debugging

View logs emmitted from failures in the solana program with `solana logs --commitment max`