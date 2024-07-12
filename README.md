# Environment

Ubuntu 22.04

# Build

`cargo build-sbf`

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

## integration tests

run the test deployment script: `python3 test/full_deploy_test.py`  

## unit tests

run `cargo test-sbf`

# Debugging

View logs emmitted from failures in the solana program with `solana logs --commitment max`  
