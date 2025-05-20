# Standalone build script for Compto and Transfer Hook programs
# Can be run directly or imported from other test scripts

import argparse
import json
from pathlib import Path
from common import (
    buildCompto, buildTransferHook, generateDirectories, generateFiles, randAddress,
    run, write, 
    COMPTOKEN_MINT_JSON, COMPTO_PROGRAM_ID_JSON, COMPTO_TRANSFER_HOOK_ID_JSON,
    COMPTO_GLOBAL_DATA_ACCOUNT_JSON, MINT_DECIMALS, MINT_KEYPAIR, TOKEN_2022_PROGRAM_ID,
    TRANSFER_HOOK_KEYPAIR,
)

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
    run(CREATE_TOKEN_CMD)
    print("Token created.")

def generateMockFiles():
    comptokenProgramId = generateMockComptokenProgramIdFile()
    transferHookId = generateMockTransferHookProgramIdFile()
    mintAddress = generateMockMint()
    return (comptokenProgramId, transferHookId, mintAddress)


def generateMockComptokenProgramIdFile():
    programId = randAddress()
    write(COMPTO_PROGRAM_ID_JSON, json.dumps({"programId": programId}))
    return programId

def generateMockTransferHookProgramIdFile():
    programId = randAddress()
    write(COMPTO_TRANSFER_HOOK_ID_JSON, json.dumps({"programId": programId}))
    return programId

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

class BuildArgs(argparse.Namespace):
    steps: list[str]
    skip: list[str] | None
    log_directory: Path | None
    features: list[str]
    verbose: int

def parseArgs(rawArgs: list[str] | None = None) -> BuildArgs:
    STEPS = ["generate", "create-token", "build"]
    parser = argparse.ArgumentParser(prog="build_comptoken_program", description="Build and generate files for comptoken programs.")
    parser.add_argument("--skip", nargs='+', choices=STEPS, help="skip step")
    parser.add_argument("--log-directory", type=Path, help="logs test output to the specified directory")
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
        print("Creating token...")
        createToken()
        print("Token created.")

    if "build" in args.steps:
        print("Building Compto and Transfer Hook programs...")
        buildCompto(features=args.features)
        buildTransferHook(features=args.features)
        print("Build complete.")

if __name__ == "__main__":
    args = parseArgs()
    
    if len(args.steps) == 0:
        print("Nothing to do. Exiting.")
        exit(0)

    build(args)
