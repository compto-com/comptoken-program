import json
import os
import sys
from argparse import ArgumentParser, Namespace
from contextlib import contextmanager

from common import *


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

    extraAccountMetasSeed = setExtraAccountMetasPDA(transferHookId, Pubkey(mint_address))["bumpSeed"]
    # test user
    generateTestUser()
    # rust file
    generateComptokenAddressFile(
        globalDataSeed, interestBankSeed, verifiedHumanUBIBankSeed, futureUBIBankSeed, mint_address, transferHookId
    )
    generateTransferHookAddressFile(
        comptokenProgramId, extraAccountMetasSeed, mint_address, interestBankAddress, verifiedHumanUBIBankAddress
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
        print(f"✅ \033[92m{file}\033[0m passed")
        return True
    except SubprocessFailedException as e:
        print(f"❌ \033[91m{file}\033[0m failed")
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
    print(f"passed: {passed}    failed: {failed}")

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
    comptoken_tests: list[str] = [
        "initializeComptokenProgram",
        "mint",  # testing to see if the timeout problem is mint or first test
        "createUserDataAccount",
        "proofSubmission",
        "getValidBlockhashes",
        "getOwedComptokens",
        "earlyDailyDistributionEvent",
        "dailyDistributionEvent",
        "growUserDataAccount",
        "shrinkUserDataAccount",
        "multidayDailyDistribution",
        "randomMultidayDailyDistribution",
        "dailyDistributionNoMining",
        "dailyDistributionUnderHWM",
        "dailyDistributionAtHWM",
        "dailyDistributionBelowMaxHWM",
        "dailyDistributionAtMaxHWM",
        "dailyDistributionAboveMaxHWM",
    ]
    transfer_hook_tests: list[str] = [
        "initialize_extra_account_meta_list",
        "execute",
    ]

    tests = list(map(lambda test: "comptoken-tests/" + test, comptoken_tests)
                 ) + list(map(lambda test: "transfer-hook-tests/" + test, transfer_hook_tests))

    args = parseArgs()
    generateDirectories(args)
    if args.build:
        generateFiles()
        build()
    else:
        print("skipping generating files")
        print("skipping building")

    runTests(args, tests)
