import json
import os
import subprocess
from contextlib import contextmanager
from pathlib import Path
from time import sleep, time

from common import *

SPL_TOKEN_CMD = f"spl-token --program-id {TOKEN_2022_PROGRAM_ID}"

@contextmanager
def createTestValidator():
    with BackgroundProcess(
        "solana-test-validator --reset",
        shell=True,
        cwd=CACHE_PATH,
        stdout=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    ) as validator:
        waitTillValidatorReady(validator)
        yield validator

def checkIfValidatorReady(validator: BackgroundProcess) -> bool:
    if not validator.checkIfProcessRunning():
        print("validator not running")
        return False
    try:
        run("solana ping -c 1")
        return True
    except Exception:
        return False

def waitTillValidatorReady(validator: BackgroundProcess):
    print("Checking Validator Ready...")
    TIMEOUT = 10
    t1 = time()
    while not checkIfValidatorReady(validator):
        if t1 + TIMEOUT < time():
            print("Validator Timeout, Exiting...")
            exit(1)
        print("Validator Not Ready")
        sleep(1)
    print("Validator Ready")

# ==== SOLANA COMMANDS ====

def getComptoProgramIdIfExists() -> str | None:
    try:
        return getComptoProgramId()
    except SubprocessFailedException:
        return None

def getComptoProgramId():
    return run(f"solana address -k {COMPTO_KEYPAIR}")

def getTransferHookProgramIdIfExists() -> str | None:
    try:
        return getTransferHookProgramId()
    except SubprocessFailedException:
        return None

def getTransferHookProgramId():
    return run(f"solana address -k {TRANSFER_HOOK_KEYPAIR}")

def getGlobalData():
    with open(COMPTO_GLOBAL_DATA_ACCOUNT_JSON, "r") as file:
        return json.load(file).get("address")

def createToken():
    run(
        f"{SPL_TOKEN_CMD} create-token -v --decimals {MINT_DECIMALS} --transfer-hook {getTransferHookProgramId()} --mint-authority {getGlobalData()} --output json {MINT_KEYPAIR} > {COMPTOKEN_MINT_JSON}"
    )

def createComptoAccount():
    generateTestUser()
    run(f"solana airdrop 100 {getPubkey(TEST_USER_ACCOUNT_JSON)}")
    run(f"{SPL_TOKEN_CMD} create-account {getTokenAddress()} --owner {TEST_USER_ACCOUNT_JSON}")

def getPubkey(path: Path) -> str:
    return run(f"solana-keygen pubkey {path}")

def getAccountBalance(pubkey: str):
    return run(f"solana balance {pubkey}")

def deployCompto():
    print("Deploying Compto...")
    run(f"solana program deploy -v {COMPTO_SO} --output json > {COMPTO_PROGRAM_ID_JSON}")
    print("Deployed Compto")

def deployTransferHook():
    print("Deploying Transfer Hook...")
    run(f"solana program deploy -v {TRANSFER_HOOK_SO} --output json > {COMPTO_TRANSFER_HOOK_ID_JSON}")
    print("Deployed Transfer Hook")
    # TODO: find a more efficient way to do this
    try:
        json.loads(run(f"{SPL_TOKEN_CMD} display {getTokenAddress()} --output json")).get("MintAuthority")
        return True
    except (FileNotFoundError, SubprocessFailedException, json.decoder.JSONDecodeError):
        return False
    except Exception as ex:
        print(f"new Exception: Type:`{type(ex)}' value: `{ex}'")
        raise ex

def getTokenAddress():
    return run(f"solana address -k {MINT_KEYPAIR}")

# ========================

def runTestClient():
    return run("node --trace-warnings compto-test-client/test_client.js", TEST_PATH)

if __name__ == "__main__":
    args = parseArgs()
    # create cache if it doesn't exist
    generateDirectories(args=argparse.Namespace(log_directory=None, verbose=0))
    # If ProgramId doesn't exist, we need to build WITHOUT the testmode feature.
    # This is because the static seed in testmode depends on ProgramId and ProgramId
    # is generated on the first build.
    print("Checking if Comptoken ProgramId exists...")
    comptokenProgramId = getComptoProgramIdIfExists()
    if comptokenProgramId is None:
        print("Creating Comptoken ProgramId...")
        createKeyPair(COMPTO_KEYPAIR)
        #run("cargo build-sbf", COMPTOKEN_SRC_PATH)
        comptokenProgramId = getComptoProgramId()

    transferHookId = getTransferHookProgramIdIfExists()
    if transferHookId is None:
        print("Creating Transfer Hook ProgramId...")
        createKeyPair(TRANSFER_HOOK_KEYPAIR)
        #run("cargo build-sbf", TRANSFER_HOOK_SRC_PATH)
        transferHookId = getTransferHookProgramId()

    print("Creating Validator...")
    with createTestValidator() as validator:
        print("Checking Compto Program for hardcoded Comptoken Address and static seed...")

        if args.generate:
            createKeyPair(MINT_KEYPAIR)
            mintAddress = getTokenAddress()
            generateFiles(comptokenProgramId, transferHookId, mintAddress)

        createToken()

        if args.build:
            buildTransferHook()
            buildCompto()

        deployTransferHook()
        deployCompto()

        print("Creating Token Account...")
        createComptoAccount()
        print("Running Test Client...")
        output = runTestClient()
        print(output)
        test_account = getPubkey(TEST_USER_ACCOUNT_JSON)
        print(f"Test Account {test_account} Balance: {getAccountBalance(test_account)}")
