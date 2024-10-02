import argparse
import json
from pathlib import Path

from common import (
    COMPTO_GLOBAL_DATA_ACCOUNT_JSON,
    COMPTO_KEYPAIR,
    COMPTO_PROGRAM_ID_JSON,
    COMPTO_SO,
    COMPTO_TRANSFER_HOOK_ID_JSON,
    COMPTOKEN_MINT_JSON,
    MINT_DECIMALS,
    MINT_KEYPAIR,
    PROJECT_PATH,
    TEST_PATH,
    TEST_USER_ACCOUNT_JSON,
    TOKEN_2022_PROGRAM_ID,
    TRANSFER_HOOK_KEYPAIR,
    TRANSFER_HOOK_SO,
    SubprocessFailedException,
    createKeyPair,
    generateDirectories,
    generateFiles,
    generateTestUser,
    parseArgs,
    run,
)

# ==== SOLANA COMMANDS ====

def getAddress(path: Path) -> str:
    return run(f"solana address -k {path}")

SPL_TOKEN_CMD = f"spl-token --program-id {TOKEN_2022_PROGRAM_ID}"
CREATE_TOKEN_CMD = f"{SPL_TOKEN_CMD} create-token -v -u devnet --fee-payer ~/.config/solana/id.json --decimals {MINT_DECIMALS} --transfer-hook {getAddress(TRANSFER_HOOK_KEYPAIR)} --mint-authority 2TchvJKnE3tsdr5RKyiu1jGofnL8rhLZ9XU5nFwKVLSP --output json {MINT_KEYPAIR} > {COMPTOKEN_MINT_JSON}"
DEPLOY_CMD = "solana program deploy -v -u devnet"

def getProgramIdIfExists(path: Path) -> str | None:
    try:
        return getAddress(path)
    except SubprocessFailedException:
        return None

def getComptoProgramIdIfExists() -> str | None:
    getProgramIdIfExists(COMPTO_KEYPAIR)

def getTransferHookProgramIdIfExists() -> str | None:
    getProgramIdIfExists(TRANSFER_HOOK_KEYPAIR)

def getGlobalData():
    with open(COMPTO_GLOBAL_DATA_ACCOUNT_JSON, "r") as file:
        return json.load(file).get("address")

def createToken():
    run(CREATE_TOKEN_CMD)

def createComptoAccount():
    generateTestUser()
    run(f"solana airdrop -u devnet 5 {getPubkey(TEST_USER_ACCOUNT_JSON)}")
    run(f"{SPL_TOKEN_CMD} create-account {getTokenAddress()} --owner {TEST_USER_ACCOUNT_JSON}")

def getPubkey(path: Path) -> str:
    return run(f"solana-keygen pubkey {path}")

def getAccountBalance(pubkey: str):
    return run(f"solana balance {pubkey}")

def deployCompto():
    print("Deploying Compto...")
    run(f"{DEPLOY_CMD} {COMPTO_SO} --output json > {COMPTO_PROGRAM_ID_JSON}")
    print("Deployed Compto")

def deployTransferHook():
    print("Deploying Transfer Hook...")
    run(f"{DEPLOY_CMD} {TRANSFER_HOOK_SO} --output json > {COMPTO_TRANSFER_HOOK_ID_JSON}")
    print("Deployed Transfer Hook")

def getTokenAddress():
    return run(f"solana address -k {MINT_KEYPAIR}")

# ========================

def build(package: str):
    print(f"Building {package}...")
    run(f'cargo build-sbf -- -v -p {package}', PROJECT_PATH)
    print(f"Done Building {package}")

def buildCompto():
    build("comptoken")

def buildTransferHook():
    build("comptoken-transfer-hook")


def runTestClient():
    return run("node --trace-warnings compto-test-client/devnet_test_client.js", TEST_PATH)

if __name__ == "__main__":
    args = parseArgs()
    # create cache if it doesn't exist
    generateDirectories(args=argparse.Namespace(log_directory=None, verbose=0))
    print("Checking if Comptoken ProgramId exists...")
    #comptokenProgramId = getComptoProgramIdIfExists()
    #if comptokenProgramId is None:
    #    print("Creating Comptoken ProgramId...")
    #    createKeyPair(COMPTO_KEYPAIR)
    #    #run("cargo build-sbf", COMPTOKEN_SRC_PATH)
    #    comptokenProgramId = getAddress(COMPTO_KEYPAIR)

    #transferHookId = getTransferHookProgramIdIfExists()
    #if transferHookId is None:
    #    print("Creating Transfer Hook ProgramId...")
    #    createKeyPair(TRANSFER_HOOK_KEYPAIR)
    #    #run("cargo build-sbf", TRANSFER_HOOK_SRC_PATH)
    #    transferHookId = getAddress(TRANSFER_HOOK_KEYPAIR)

    #createKeyPair(MINT_KEYPAIR)
    #mintAddress = getTokenAddress()
    #generateFiles(comptokenProgramId, transferHookId, mintAddress)

    #input("Press Enter to Continue After Updating Rust Files to Contain Correct ProgramId's, PDA's, Bumps, etc.")

    #buildTransferHook()
    #buildCompto()

    #createToken()

    #deployTransferHook()
    #deployCompto()

    print("Creating Token Account...")
    createComptoAccount()
    print("Running Test Client...")
    output = runTestClient()
    print(output)
    test_account = getPubkey(TEST_USER_ACCOUNT_JSON)
    print(f"Test Account {test_account} Balance: {getAccountBalance(test_account)}")
