import json
import os
from argparse import ArgumentParser, Namespace

from common import *


def generateFiles():
    print("generating files...")
    # create cache if it doesn't exist
    run(f"[ -d {CACHE_PATH} ] || mkdir {CACHE_PATH} ")
    run(f"[ -d {COMPTOKEN_GENERATED_PATH} ] || mkdir {COMPTOKEN_GENERATED_PATH} ")
    run(f"[ -d {TRANSFER_HOOK_GENERATED_PATH} ] || mkdir {TRANSFER_HOOK_GENERATED_PATH} ")
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
    UBIBankPDA = setUBIBankPDA(comptokenProgramId)
    UBIBankSeed = UBIBankPDA["bumpSeed"]
    UBIBankAddress = UBIBankPDA["address"]

    extraAccountMetasSeed = setExtraAccountMetasPDA(transferHookId, Pubkey(mint_address))["bumpSeed"]
    # test user
    generateTestUser()
    # rust file
    generateComptokenAddressFile(globalDataSeed, interestBankSeed, UBIBankSeed, mint_address, transferHookId)
    generateTransferHookAddressFile(
        comptokenProgramId, extraAccountMetasSeed, mint_address, interestBankAddress, UBIBankAddress
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
    try:
        stdout = run(f"{node} {TEST_PATH / f'compto-test-client/{file}'}", env=env)
        if args.verbose >= 1:
            print(stdout)
        print(f"✅ \033[92m{file}\033[0m passed")
        return True
    except SubprocessFailedException as e:
        print(f"❌ \033[91m{file}\033[0m failed")
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

def parseArgs():
    parser = ArgumentParser(prog="comptoken component tests")
    parser.add_argument("--verbose", "-v", action="count", default=0)
    parser.add_argument("--no-build", action="store_false", dest="build")

    return parser.parse_args()

if __name__ == "__main__":
    comptoken_tests: list[str] = [
        "mint", "initializeComptokenProgram", "createUserDataAccount", "proofSubmission", "getValidBlockhashes",
        "getOwedComptokens", "dailyDistributionEvent"
    ]
    transfer_hook_tests: list[str] = [
        "initialize_extra_account_meta_list", "execute"
    ]

    tests = list(map(lambda test: "comptoken-tests/" + test, comptoken_tests)
                 ) + list(map(lambda test: "transfer-hook-tests/" + test, transfer_hook_tests))

    args = parseArgs()
    if args.build:
        generateFiles()
        build()
    else:
        print("skipping generating files")
        print("skipping building")

    runTests(args, tests)
