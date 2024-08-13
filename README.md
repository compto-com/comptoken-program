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

# Testing

`pip install -r test/requirements.txt`  

## Test Dependencies

python ^3.11.6  
navigate to `test/compto-test-client` and run `npm install`  

## Unit Tests

run `cargo test-sbf`  

## Component Tests

run the test script: `python3 test/component_tests.py`

## Integration Tests

run the test deployment script: `python3 test/full_deploy_test.py`  

# Debugging

View logs emmitted from failures in the solana program with `solana logs --commitment max`  
