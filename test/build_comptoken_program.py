# Standalone build script for Compto and Transfer Hook programs
# Can be run directly or imported from other test scripts

import argparse
import json
from pathlib import Path

from common import (
    COMPTO_GLOBAL_DATA_ACCOUNT_JSON,
    COMPTO_KEYPAIR,
    COMPTO_PROGRAM_ID_JSON,
    COMPTO_TRANSFER_HOOK_ID_JSON,
    COMPTOKEN_MINT_JSON,
    MINT_DECIMALS,
    MINT_KEYPAIR,
    TOKEN_2022_PROGRAM_ID,
    TRANSFER_HOOK_KEYPAIR,
)
from common import build as compile_programs
from common import createTestValidator, generateDirectories, generateFiles, run, write


def getAddress(path: Path) -> str:
    return run(f"solana address -k {path}")

def getGlobalData():
    with open(COMPTO_GLOBAL_DATA_ACCOUNT_JSON, "r") as file:
        return json.load(file).get("address")

SPL_TOKEN_CMD = f"spl-token --program-id {TOKEN_2022_PROGRAM_ID} -u localhost"

def createToken():
    CREATE_TOKEN_CMD = (
        f"{SPL_TOKEN_CMD} create-token -v --fee-payer ~/.config/solana/id.json "
        f"--decimals {MINT_DECIMALS} --transfer-hook {getAddress(TRANSFER_HOOK_KEYPAIR)} "
        f"--mint-authority {getGlobalData()} --output json {MINT_KEYPAIR}"
    )
    print("Creating token...")
    result = run(CREATE_TOKEN_CMD)
    write(COMPTOKEN_MINT_JSON, result)
    print("Token created.")

def generateMockFiles():
    comptokenProgramId = generateMockComptokenProgramIdFile()
    transferHookId = generateMockTransferHookProgramIdFile()
    mintAddress = generateMockMint()
    return (comptokenProgramId, transferHookId, mintAddress)


def generateMockComptokenProgramIdFile():
    programId = getAddress(COMPTO_KEYPAIR)
    write(COMPTO_PROGRAM_ID_JSON, json.dumps({"programId": programId}))
    return programId

def generateMockTransferHookProgramIdFile():
    programId = getAddress(TRANSFER_HOOK_KEYPAIR)
    write(COMPTO_TRANSFER_HOOK_ID_JSON, json.dumps({"programId": programId}))
    return programId

def generateMockMint() -> str:
    address = getAddress(MINT_KEYPAIR)
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

class BuildArgs(argparse.Namespace):
    steps: list[str]
    skip: list[str] | None
    features: list[str]
    verbose: int

def parseArgs(rawArgs: list[str] | None = None) -> BuildArgs:
    STEPS = ["generate", "create-token", "build"]
    parser = argparse.ArgumentParser(prog="build_comptoken_program", description="Build and generate files for comptoken programs.")
    parser.add_argument("--skip", nargs='+', choices=STEPS, help="skip step")
    parser.add_argument("--features", nargs="+", default=[], help="features to enable")
    parser.add_argument("--verbose", "-v", action="count", default=0)
    args = parser.parse_args(rawArgs, namespace=BuildArgs())

    steps = [step for step in STEPS if not (args.skip and step in args.skip)]
    args.steps = steps
    return args

def build(args: BuildArgs):
    generateDirectories(args)

    if "generate" in args.steps:
        print("Generating mock files for build...")
        (comptokenProgramId, transferHookId, mintAddress) = generateMockFiles()
        generateFiles(comptokenProgramId, transferHookId, mintAddress)
        print("Files generated.")

    if "create-token" in args.steps:
        with createTestValidator(reset=True):
            print("Creating token...")
            createToken()
            print("Token created.")

    if args.verbose > 0:
        print(f"comptokenProgramId: {getAddress(COMPTO_KEYPAIR)}")
        print(f"transferHookId: {getAddress(TRANSFER_HOOK_KEYPAIR)}")
        print(f"mintAddress: {getAddress(MINT_KEYPAIR)}")
        print(f"globalData: {getGlobalData()}")

    if "build" in args.steps:
        print("Building Compto and Transfer Hook programs...")
        compile_programs(None, features=args.features)
        print("Build complete.")

if __name__ == "__main__":
    args = parseArgs()
    
    if len(args.steps) == 0:
        print("Nothing to do. Exiting.")
        exit(0)

    if args.verbose > 0:
        print(f"Verbose level: {args.verbose}")
        print(f"Log directory: {args.log_directory}")
        print(f"Features: {args.features}")

    build(args)
