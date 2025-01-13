import json
import os
import subprocess
from contextlib import contextmanager
from pathlib import Path
from time import sleep, time

from common import *


@contextmanager
def createTestValidator(manual_validator: bool):
    if manual_validator:
        # If manual validator, we don't need to start a validator
        # and we don't need to wait for it to be ready (since that's already been checked)
        print("Manual Validator Mode, Skipping Validator Creation...")
        yield None
        return
    
    print("Creating Validator...")
    with BackgroundProcess(
        "solana-test-validator --reset",
        shell=True,
        cwd='/tmp' if is_windows_subdirectory_in_wsl(CACHE_PATH) else CACHE_PATH, # solana-test-validator doesn't work in WSL if the path is in the Windows filesystem
        stdout=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    ) as validator:
        waitTillValidatorReady(validator)
        yield validator

def checkIfValidatorReady() -> bool:
    try:
        run("solana ping -c 1")
        return True
    except Exception:
        return False

def waitTillValidatorReady(validator: BackgroundProcess):
    print("Checking Validator Ready...")
    TIMEOUT = 10
    t1 = time()
    while not (validator.checkIfProcessRunning() and checkIfValidatorReady()):
        if t1 + TIMEOUT < time():
            print("Validator Timeout, Exiting...")
            exit(1)
        print("Validator Not Ready")
        sleep(1)
    print("Validator Ready")

# ==== SOLANA COMMANDS ====

def getAddress(path: Path) -> str:
    return run(f"solana address -k {path}")

def getGlobalData():
    with open(COMPTO_GLOBAL_DATA_ACCOUNT_JSON, "r") as file:
        return json.load(file).get("address")

SPL_TOKEN_CMD = f"spl-token --program-id {TOKEN_2022_PROGRAM_ID} -u localhost"
CREATE_TOKEN_CMD = f"{SPL_TOKEN_CMD} create-token -v --fee-payer ~/.config/solana/id.json --decimals {MINT_DECIMALS} --transfer-hook {getAddress(TRANSFER_HOOK_KEYPAIR)} --mint-authority {getGlobalData()} --output json {MINT_KEYPAIR} > {COMPTOKEN_MINT_JSON}"
DEPLOY_CMD = "solana program deploy -v -u localhost"

def getProgramIdIfExists(path: Path) -> str | None:
    try:
        return getAddress(path)
    except SubprocessFailedException:
        return None

def getComptoProgramIdIfExists() -> str | None:
    return getProgramIdIfExists(COMPTO_KEYPAIR)

def getTransferHookProgramIdIfExists() -> str | None:
    return getProgramIdIfExists(TRANSFER_HOOK_KEYPAIR)

def createToken():
    run(CREATE_TOKEN_CMD)

def createComptoAccount():
    generateTestUser()
    run(f"solana airdrop -u localhost 5 {getPubkey(TEST_USER_ACCOUNT_JSON)}")
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

def runTestClient():
    return run("node --trace-warnings compto-test-client/test_client.js", TEST_PATH)

if __name__ == "__main__":
    args = parseArgs()

    if (args.manual_validator and not checkIfValidatorReady()):
        print("Manual Validator flag set, but no validator is running. Exiting...")
        exit(1)
    if (not args.manual_validator and checkIfValidatorReady()):
        print("Validator is already running, please stop the validator or set the manual_validator flag. Exiting...")
        exit(1)
        
    # create cache if it doesn't exist
    generateDirectories(args=argparse.Namespace(log_directory=None, verbose=0))
    print("Checking if Comptoken ProgramId exists...")
    comptokenProgramId = getComptoProgramIdIfExists()
    if comptokenProgramId is None:
        print("Creating Comptoken ProgramId...")
        createKeyPair(COMPTO_KEYPAIR)
        #run("cargo build-sbf", COMPTOKEN_SRC_PATH)
        comptokenProgramId = getAddress(COMPTO_KEYPAIR)

    transferHookId = getTransferHookProgramIdIfExists()
    if transferHookId is None:
        print("Creating Transfer Hook ProgramId...")
        createKeyPair(TRANSFER_HOOK_KEYPAIR)
        #run("cargo build-sbf", TRANSFER_HOOK_SRC_PATH)
        transferHookId = getAddress(TRANSFER_HOOK_KEYPAIR)

    with createTestValidator(args.manual_validator) as validator:
        # if in manual validator mode, validator is None

        print("Checking Compto Program for hardcoded Comptoken Address and static seed...")

        if args.generate:
            createKeyPair(MINT_KEYPAIR)
            mintAddress = getTokenAddress()
            generateFiles(comptokenProgramId, transferHookId, mintAddress)

        createToken()

        if args.build:
            buildTransferHook(features=["testmode"])
            buildCompto(features=["testmode"])

        deployTransferHook()
        deployCompto()

        print("Creating Token Account...")
        createComptoAccount()
        print("Running Test Client...")
        output = runTestClient()
        print(output)
        test_account = getPubkey(TEST_USER_ACCOUNT_JSON)
        print(f"Test Account {test_account} Balance: {getAccountBalance(test_account)}")

        # wait for input
        input("Press Enter to continue...")
