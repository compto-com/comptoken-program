# Environment

Ubuntu 22.04  

# Build

Default build:  
`cargo build-sbf`  
Testing build (If building for the first time default build must be done first):  
`cargo build-sbf --features testmode` 

# Local Environment

## Dependencies

Install rust and the solana CLI (see docs: https://solana.com/tr/developers/guides/getstarted/setup-local-development)  

```bash
sudo apt install pre-commit
pre-commit install
```

## Test Dependencies

python ^3.11.6  
navigate to `test/compt-test-client` and run `npm install`  

# Testing

`pip install -r test/requirements.txt`  

## Unit Tests

run `cargo test-sbf`  

## Component Tests

Prerequisite: Build the project for testmode.
Set the location of `comptoken.so`  
`export SBF_OUT_DIR=$(pwd)/target/deploy`  
run with `node test/compto-test-client/<test>`  

available component tests: 
- test_mint
- initialize_comptoken_program
- test_getValidBlockhashes
- test_createUserDataAccount

## Integration Tests

run the test deployment script: `python3 test/full_deploy_test.py`  

# Debugging

View logs emmitted from failures in the solana program with `solana logs --commitment max`  
