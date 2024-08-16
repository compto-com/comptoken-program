import json
import os
import subprocess
from pathlib import Path
from time import sleep, time

from common import *

SPL_TOKEN_CMD = f"spl-token --program-id {TOKEN_2022_PROGRAM_ID}"

def checkIfValidatorReady(validator: BackgroundProcess) -> bool:
    if not validator.checkIfProcessRunning():
        return False
    try:
        run("solana ping -c 1")
        return True
    except Exception:
        return False

def waitTillValidatorReady(validator: BackgroundProcess):
    TIMEOUT = 10
    t1 = time()
    while not checkIfValidatorReady(validator):
        if t1 + TIMEOUT < time():
            print("Validator Timeout, Exiting...")
            exit(1)
        print("Validator Not Ready")
        sleep(1)

# ==== SOLANA COMMANDS ====

def checkIfProgamIdExists():
    try:
        getProgramId()
        return True
    except SubprocessFailedException:
        return False

def getProgramId():
    return run(f"solana address -k target/deploy/comptoken-keypair.json")

def createToken():
    run(f"{SPL_TOKEN_CMD} create-token -v --decimals {MINT_DECIMALS} --output json > {COMPTOKEN_MINT_JSON}")

def createComptoAccount():
    generateTestUser()
    run(f"{SPL_TOKEN_CMD} create-account {getTokenAddress()} {TEST_USER_ACCOUNT_JSON}")

def getPubkey(path: Path) -> str:
    return run(f"solana-keygen pubkey {path}")

def getAccountBalance(pubkey: str):
    return run(f"solana balance {pubkey}")

def deploy():
    run(f"solana program deploy -v {COMPTO_SO} --output json > {COMPTO_PROGRAM_ID_JSON}")

def checkIfCurrentMintAuthorityExists() -> bool:
    # TODO: find a more efficient way to do this
    try:
        json.loads(run(f"{SPL_TOKEN_CMD} display {getTokenAddress()} --output json")).get("MintAuthority")
        return True
    except (FileNotFoundError, SubprocessFailedException, json.decoder.JSONDecodeError):
        return False
    except Exception as ex:
        print(f"new Exception: Type:`{type(ex)}' value: `{ex}'")
        raise ex

def getCurrentMintAuthority() -> str:
    return json.loads(run(f"{SPL_TOKEN_CMD} display {getTokenAddress()} --output json")).get("MintAuthority")

# ==== SHELL COMMANDS ====

def getComptoMd5():
    return run(f"md5sum {COMPTO_SO}", PROJECT_PATH).split()[0]

# ========================

def checkIfProgamIdChanged() -> bool:
    # Only deploy if the program id has changed
    if not COMPTO_PROGRAM_ID_JSON.exists():
        return False
    real_program_id = getProgramId()
    cached_program_id = json.loads(COMPTO_PROGRAM_ID_JSON.read_text())["programId"]
    return real_program_id != cached_program_id

def deployIfNeeded():
    # Only deploy if the md5sum of the program has changed
    md5sum = getComptoMd5()
    if (not COMPTO_MD5_JSON.exists() or json.loads(COMPTO_MD5_JSON.read_text())["md5sum"] != md5sum):
        COMPTO_MD5_JSON.write_text(json.dumps({"md5sum": md5sum}))
        deploy()
    else:
        print("Program has not changed, skipping deploy.")

def checkIfTokenAddressExists() -> bool:
    return COMPTOKEN_MINT_JSON.exists()

def getTokenAddress():
    return (json.loads(COMPTOKEN_MINT_JSON.read_text()).get("commandOutput").get("address"))

def runTestClient():
    return run("node --trace-warnings compto-test-client/test_client.js", TEST_PATH)

if __name__ == "__main__":
    # create cache if it doesn't exist
    run(f"[ -d {CACHE_PATH} ] || mkdir {CACHE_PATH} ")
    run(f"[ -d {COMPTOKEN_GENERATED_PATH} ] || mkdir {COMPTOKEN_GENERATED_PATH} ")
    run(f"[ -d {TRANSFER_HOOK_GENERATED_PATH} ] || mkdir {TRANSFER_HOOK_GENERATED_PATH} ")
    # If ProgramId doesn't exist, we need to build WITHOUT the testmode feature.
    # This is because the static seed in testmode depends on ProgramId and ProgramId
    # is generated on the first build.
    print("Checking if Comptoken ProgramId exists...")
    if not checkIfProgamIdExists():
        print("Creating Comptoken ProgramId...")
        run("cargo build-sbf", PROJECT_PATH)
    print("Creating Validator...")
    with BackgroundProcess(
        "solana-test-validator --reset",
        shell=True,
        cwd=CACHE_PATH,
        stdout=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    ) as validator:
        print("Checking Validator Ready...")
        waitTillValidatorReady(validator)
        print("Validator Ready")
        createToken()
        programId = getProgramId()
        globalDataPDA = setGlobalDataPDA(programId)
        interestBankPDA = setInterestBankPDA(programId)
        UBIBankPDA = setVerifiedHumanUBIBankPDA(programId)
        comptoken_id = getTokenAddress()
        print("Checking Compto Program for hardcoded Comptoken Address and static seed...")
        generateComptokenAddressFile(
            globalDataPDA["bumpSeed"], interestBankPDA["bumpSeed"], UBIBankPDA["bumpSeed"], comptoken_id
        )
        print("Creating Token Account...")
        createComptoAccount()
        print("Building...")
        build()
        print("Deploying...")
        deployIfNeeded()
        print("Running Test Client...")
        output = runTestClient()
        print(output)
        test_account = getPubkey(TEST_USER_ACCOUNT_JSON)
        print(f"Test Account {test_account} Balance: {getAccountBalance(test_account)}")
