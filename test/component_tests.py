import json
import os
from argparse import ArgumentParser, Namespace

from common import *


def generateFiles():
    print("generating files...")
    # create cache if it doesn't exist
    run(f"[ -d {CACHE_PATH} ] || mkdir {CACHE_PATH} ")
    run(f"[ -d {GENERATED_PATH} ] || mkdir {GENERATED_PATH} ")
    # programId
    programId = randAddress()
    generateMockProgramIdFile(programId)
    # mint
    mint_address = generateMockMint()
    # pdas
    globalDataPDA = setGlobalDataPDA(programId)
    interestBankPDA = setInterestBankPDA(programId)
    UBIBankPDA = setUBIBankPDA(programId)
    # test user
    generateTestUser()
    # rust file
    generateComptokenAddressFile(
        globalDataPDA["bumpSeed"], interestBankPDA["bumpSeed"], UBIBankPDA["bumpSeed"], mint_address
    )
    print("done generating files")

def generateMockProgramIdFile(programId: str):
    write(COMPTO_PROGRAM_ID_JSON, json.dumps({"programId": programId}))

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

def runTest(args: Namespace, test: str, file: str) -> bool:
    print(f"running {test}")
    env = os.environ
    env["SBF_OUT_DIR"] = str(PROJECT_PATH / "target/deploy/")
    node = ("node --trace-warnings" if args.verbose >= 2 else "node")
    try:
        stdout = run(f"{node} {TEST_PATH / f'compto-test-client/{file}'}", env=env)
        if args.verbose >= 1:
            print(stdout)
        print(f"✅ \033[92m{test}\033[0m passed")
        return True
    except SubprocessFailedException as e:
        print(f"❌ \033[91m{test}\033[0m failed")
        print(e)
        return False

def runTests(args: Namespace, tests: list[str]):
    print("running tests...")

    passed = 0
    for test in tests:
        passed += runTest(args, test, f'test_{test}')
    failed = len(tests) - passed
    print()
    print(f"passed: {passed}    failed: {failed}")

def parseArgs():
    parser = ArgumentParser(prog="comptoken component tests")
    parser.add_argument("--verbose", "-v", action="count", default=0)

    return parser.parse_args()

if __name__ == "__main__":
    tests = [
        "mint", "initializeComptokenProgram", "createUserDataAccount", "proofSubmission", "getValidBlockhashes",
        "getOwedComptokens", "dailyDistributionEvent"
    ]
    args = parseArgs()
    generateFiles()
    build()
    runTests(args, tests)
