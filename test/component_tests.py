import json
import os
import sys
from argparse import ArgumentParser, Namespace
from contextlib import contextmanager

from common import *

ANSI_GREEN = "\033[92m"
ANSI_RED = "\033[91m"
ANSI_RESET = "\033[0m"

def createDirIfNotExists(path: str | Path):
    run(f"[ -d {path} ] || mkdir {path} ")

def generateDirectories(args: Namespace):
    createDirIfNotExists(CACHE_PATH)
    createDirIfNotExists(COMPTOKEN_GENERATED_PATH)
    createDirIfNotExists(TRANSFER_HOOK_GENERATED_PATH)
    if args.log_directory:
        createDirIfNotExists(args.log_directory)
        createDirIfNotExists(args.log_directory / "comptoken-tests")
        createDirIfNotExists(args.log_directory / "transfer-hook-tests")

def generateFiles():
    print("generating files...")
    # programId
    comptokenProgramId = randAddress()
    transferHookId = randAddress()
    generateMockComptokenProgramIdFile(comptokenProgramId)
    generateMockTransferHookProgramIdFile(transferHookId)
    # mint
    mint_address = generateMockMint()
    # pdas
    globalDataSeed = setGlobalDataPDA(comptokenProgramId)["bumpSeed"]

    interestBankPDA = setInterestBankPDA(comptokenProgramId)
    interestBankSeed = interestBankPDA["bumpSeed"]
    interestBankAddress = interestBankPDA["address"]
    verifiedHumanUBIBankPDA = setVerifiedHumanUBIBankPDA(comptokenProgramId)
    verifiedHumanUBIBankSeed = verifiedHumanUBIBankPDA["bumpSeed"]
    verifiedHumanUBIBankAddress = verifiedHumanUBIBankPDA["address"]
    futureUBIBankPDA = setFutureUBIBankPDA(comptokenProgramId)
    futureUBIBankSeed = futureUBIBankPDA["bumpSeed"]
    futureUBIBankAddress = futureUBIBankPDA["address"]

    extraAccountMetasSeed = setExtraAccountMetasPDA(transferHookId, Pubkey(mint_address))["bumpSeed"]
    # test user
    generateTestUser()
    # rust file
    generateComptokenAddressFile(
        globalDataSeed, interestBankSeed, verifiedHumanUBIBankSeed, futureUBIBankSeed, mint_address, transferHookId
    )
    generateTransferHookAddressFile(
        comptokenProgramId, extraAccountMetasSeed, mint_address, interestBankAddress, verifiedHumanUBIBankAddress, futureUBIBankAddress
    )
    print("done generating files")

def generateMockComptokenProgramIdFile(programId: str):
    write(COMPTO_PROGRAM_ID_JSON, json.dumps({"programId": programId}))

def generateMockTransferHookProgramIdFile(programId: str):
    write(COMPTO_TRANSFER_HOOK_ID_JSON, json.dumps({"programId": programId}))

def generateMockMint() -> str:
    address = randAddress()
    file_data = f'''\
{{
    "commandName": "CreateToken",
    "commandOutput": {{
        "address": "{address}",
        "decimals": {MINT_DECIMALS},
        "transactionData": {{
            "signature": ""
        }}
    }}
}}\
'''
    write(COMPTOKEN_MINT_JSON, file_data)
    return address

def runTest(args: Namespace, file: str) -> bool:
    print(f"running {file}")
    env = os.environ
    env["SBF_OUT_DIR"] = str(PROJECT_PATH / "target/deploy/")
    node = ("node --trace-warnings" if args.verbose >= 2 else "node")
    verbosity = "" if args.verbose == 0 else "-" + "v" * args.verbose
    command = f"{node} {TEST_PATH / f'compto-test-client/{file}'} {verbosity}"
    if args.verbose >= 2:
        print(f"command is '{command}'")
    try:
        stdout = run(command, env=env, timeout=20)
        if args.verbose >= 1:
            logfilePath = args.log_directory / f"{file}.log" if args.log_directory else None
            with file_or_stdout(logfilePath) as logfile:
                logfile.write(stdout)
        print(f"✅ {ANSI_GREEN}{file}{ANSI_RESET} passed")
        return True
    except SubprocessFailedException as e:
        print(f"❌ {ANSI_RED}{file}{ANSI_RESET} failed")
        logfilePath = args.log_directory / f"{file}.log" if args.log_directory else None
        with file_or_stdout(logfilePath) as logfile:
            logfile.write(str(e))
        print(e)
        return False

def runTests(args: Namespace, tests: list[str]):
    print("running tests...")

    passed = 0
    for test in tests:
        passed += runTest(args, test)
    failed = len(tests) - passed
    print()
    color = ANSI_GREEN if failed == 0 else ANSI_RED
    print(f"{color}passed: {passed}    failed: {failed}{ANSI_RESET}")
    if failed > 0:
        sys.exit(1)

@contextmanager
def file_or_stdout(outfile: Path | None):
    if outfile is not None:
        with open(outfile, "w+") as file:
            yield file
    else:
        yield sys.stdout

def parseArgs():
    parser = ArgumentParser(prog="comptoken component tests")
    parser.add_argument("--verbose", "-v", action="count", default=0)
    parser.add_argument("--log-directory", type=Path, help="logs test output to the specified directory")
    parser.add_argument(
        "--log",
        action="store_const",
        const=CACHE_PATH / "logs",
        dest="log_directory",
        help="logs test output to the test/.cache/logs directory"
    )
    parser.add_argument("--no-build", action="store_false", dest="build")

    return parser.parse_args()

if __name__ == "__main__":
    tests: list[str] = [
        "comptoken-tests/initializeComptokenProgram",
        "comptoken-tests/mint",  # testing to see if the timeout problem is mint or first test
        "comptoken-tests/createUserDataAccount",
        "comptoken-tests/growUserDataAccount",
        "comptoken-tests/shrinkUserDataAccount",
        "comptoken-tests/proofSubmission",
        "comptoken-tests/getValidBlockhashes",
        "comptoken-tests/getOwedComptokens",
        "comptoken-tests/earlyDailyDistributionEvent",
        "comptoken-tests/dailyDistributionEvent",
        "comptoken-tests/dailyDistributionTests",
        "comptoken-tests/multidayDailyDistribution",
        "comptoken-tests/randomMultidayDailyDistribution",
        "comptoken-tests/definedMultidayDailyDistribution",

        "transfer-hook-tests/initialize_extra_account_meta_list",
        "transfer-hook-tests/execute",
    ]

    args = parseArgs()
    generateDirectories(args)
    if args.build:
        generateFiles()
        build()
    else:
        print("skipping generating files")
        print("skipping building")

    runTests(args, tests)
