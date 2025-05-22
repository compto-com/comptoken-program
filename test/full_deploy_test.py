import argparse
from pathlib import Path

from common import (
    createKeyPair, createTestValidator, generateDirectories, generateTestUser, run,
    SubprocessFailedException,
    COMPTO_KEYPAIR, COMPTO_PROGRAM_ID_JSON, COMPTO_SO, COMPTO_TRANSFER_HOOK_ID_JSON, LOGS_PATH,
    MINT_KEYPAIR, TEST_PATH, TEST_USER_ACCOUNT_JSON, TOKEN_2022_PROGRAM_ID, TRANSFER_HOOK_KEYPAIR,
    TRANSFER_HOOK_SO,
)

# ==== SOLANA COMMANDS ====

def getAddress(path: Path) -> str:
    return run(f"solana address -k {path}")

SPL_TOKEN_CMD = f"spl-token --program-id {TOKEN_2022_PROGRAM_ID} -u localhost"
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

def parseArgs():
    parser = argparse.ArgumentParser(prog="comptoken component tests")
    parser.add_argument("--verbose", "-v", action="count", default=0)
    parser.add_argument("--log-directory", type=Path, help="logs test output to the specified directory")
    parser.add_argument(
        "--log",
        action="store_const",
        const=LOGS_PATH,
        dest="log_directory",
        help="logs test output to the test/.cache/logs directory"
    )
    parser.add_argument("--no-build", action="store_false", dest="build", help="skip building, implies --no-generate")
    parser.add_argument("--no-generate", action="store_false", dest="generate", help="skip generating files")
    parser.add_argument("--no-reset", action="store_false", dest="reset", help="skip resetting the validator")
    parser.add_argument("--kill-immediately", action="store_true", dest="kill_immediately", help="kill the validator immediately after tests, rather than waiting for input")

    args = parser.parse_args()
    if not args.build:
        args.generate = False
    return args

if __name__ == "__main__":
    args = parseArgs()
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

    print("Creating Validator...")
    with createTestValidator(reset=args.reset, verbosity=args.verbose) as validator:
        print("Checking Compto Program for hardcoded Comptoken Address and static seed...")

        if args.build:
            from build_comptoken_program import build, parseArgs as parseBuildArgs
            buildArgsList:list[str] = []
            if args.verbose:
                buildArgsList.append(f"-{'v' * args.verbose}")
            if not args.generate:
                buildArgsList.extend(['--skip', 'generate'])
            if args.log_directory is not None:
                buildArgsList.extend(['--log-directory', f'{str(args.log_directory)}'])
            buildArgsList.extend(['--features', 'testmode'])
            buildArgs = parseBuildArgs(buildArgsList)
            
            build(buildArgs)

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
        if args.kill_immediately:
            print("Killing validator immediately...")
        else:
            input("Press Enter to continue...")
