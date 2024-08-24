import json
import os
import signal
import subprocess
from argparse import ArgumentParser
from functools import reduce
from pathlib import Path
from types import TracebackType
from typing import Any, Mapping, Self, Type

TEST_PATH = Path(__file__).parent
PROJECT_PATH = TEST_PATH.parent
DEPLOY_PATH = PROJECT_PATH / "target/deploy"
COMPTOKEN_SRC_PATH = PROJECT_PATH / "comptoken"
TRANSFER_HOOK_SRC_PATH = PROJECT_PATH / "comptoken-transfer-hook"
CACHE_PATH = TEST_PATH / ".cache"
COMPTOKEN_GENERATED_PATH = COMPTOKEN_SRC_PATH / "src/generated"
TRANSFER_HOOK_GENERATED_PATH = TRANSFER_HOOK_SRC_PATH / "src/generated"

COMPTO_GENERATED_RS_FILE = COMPTOKEN_GENERATED_PATH / "comptoken_generated.rs"
TRANSFER_HOOK_GENERATED_RS_FILE = TRANSFER_HOOK_GENERATED_PATH / "comptoken_generated.rs"
COMPTO_SO = DEPLOY_PATH / "comptoken.so"
COMPTO_KEYPAIR = DEPLOY_PATH / "comptoken-keypair.json"
TRANSFER_HOOK_SO = DEPLOY_PATH / "comptoken_transfer_hook.so"
TRANSFER_HOOK_KEYPAIR = DEPLOY_PATH / "comptoken_transfer_hook-keypair.json"
MINT_KEYPAIR = CACHE_PATH / "comptoken_mint-keypair.json"

COMPTO_PROGRAM_ID_JSON = CACHE_PATH / "compto_program_id.json"
COMPTO_TRANSFER_HOOK_ID_JSON = CACHE_PATH / "compto_transfer_hook_id.json"
COMPTOKEN_MINT_JSON = CACHE_PATH / "comptoken_mint.json"
TEST_USER_ACCOUNT_JSON = CACHE_PATH / "test_user_account.json"
COMPTO_GLOBAL_DATA_ACCOUNT_JSON = CACHE_PATH / "compto_global_data_account.json"
COMPTO_INTEREST_BANK_ACCOUNT_JSON = CACHE_PATH / "compto_interest_bank_account.json"
COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_JSON = CACHE_PATH / "compto_verified_human_ubi_bank_account.json"
COMPTO_FUTURE_UBI_BANK_ACCOUNT_JSON = CACHE_PATH / "compto_future_ubi_bank_account.json"
EXTRA_ACCOUNT_METAS_ACCOUNT_JSON = CACHE_PATH / "compto_extra_account_metas_account.json"
COMPTO_MD5_JSON = CACHE_PATH / "compto_md5sum.json"

MINT_DECIMALS = 2  # MAGIC NUMBER ensure this remains consistent with constants.rs
TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

class SubprocessFailedException(Exception):
    pass

class BackgroundProcess:
    _cmd: str | list[str]
    _kwargs: dict[str, Any]
    _process: subprocess.Popen[Any] | None = None

    def __init__(self, cmd: str | list[str], **kwargs: Any):
        self._cmd = cmd
        self._kwargs = kwargs

    def __enter__(self) -> Self:
        self._process = subprocess.Popen(self._cmd, **self._kwargs)
        return self

    def __exit__(
        self,
        exc_type: Type[BaseException] | None,
        exc_value: BaseException | None,
        exc_tb: TracebackType,
    ) -> bool:
        print("Killing Background Process...")
        if self._process is not None and self.checkIfProcessRunning():
            os.killpg(os.getpgid(self._process.pid), signal.SIGTERM)
        return False

    def checkIfProcessRunning(self):
        return self._process is not None and self._process.poll() is None

    def __repr__(self) -> str:
        return f"BackgroundProcess{{_cmd: {self._cmd}, _kwargs: {self._kwargs}, _process: {self._process}}}"

class Pubkey(str):
    pass

class PDA(dict[str, Any]):

    def __init__(self, programId: str, *seeds: str | int | Pubkey) -> None:

        def get_seed_str(seed: str | int | Pubkey):
            if isinstance(seed, Pubkey):
                return f"pubkey:'{seed}'"
            elif isinstance(seed, str):
                return f"string:'{seed}'"
            elif isinstance(seed, int):  # type: ignore
                return f"hex:'{hex(seed)}'"
            else:
                raise TypeError(f"bad type: '{seed.__class__}'")

        seeds_str = reduce(lambda l, r: l + " " + r, map(get_seed_str, seeds))

        super().__init__(json.loads(run(f"solana find-program-derived-address {programId} {seeds_str} --output json")))

def createDirIfNotExists(path: str | Path):
    run(f"[ -d {path} ] || mkdir {path} ")

import argparse


def generateDirectories(args: argparse.Namespace):
    createDirIfNotExists(CACHE_PATH)
    createDirIfNotExists(COMPTOKEN_GENERATED_PATH)
    createDirIfNotExists(TRANSFER_HOOK_GENERATED_PATH)
    if args.log_directory:
        createDirIfNotExists(args.log_directory)
        createDirIfNotExists(args.log_directory / "comptoken-tests")
        createDirIfNotExists(args.log_directory / "transfer-hook-tests")

def run(
    command: str | list[str],
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
    timeout: float | None = None
) -> str:
    while True:
        try:
            result = subprocess.run(
                command, shell=True, cwd=cwd, capture_output=True, text=True, env=env, timeout=timeout
            )
            break
        except subprocess.TimeoutExpired:
            raise SubprocessFailedException(f"Failed to run command! command: '{command}' timed out")
    if result.returncode != 0:
        raise SubprocessFailedException(
            f"Failed to run command! command: '{command}' stdout: {result.stdout} stderr: {result.stderr}"
        )
    return result.stdout.rstrip()

def build(package: str):
    print(f"Building {package}...")
    run(f'cargo build-sbf --features testmode -- -v -p {package}', PROJECT_PATH)
    print(f"Done Building {package}")

def buildCompto():
    build("comptoken")

def buildTransferHook():
    build("comptoken-transfer-hook")

def write(path: Path, data: str):
    with open(path, "w") as file:
        file.write(data)

def generateComptokenAddressFile(
    globalDataSeed: int, interestBankSeed: int, verifiedHumanUBIBankSeed: int, futureUBIBankSeed: int, mintAddress: str,
    transferHookAddress: str
):
    print(f"Generating {COMPTO_GENERATED_RS_FILE}...")
    file_data = f"""\
// AUTOGENERATED DO NOT TOUCH
// generated by test/common.py

// A given seed and program id have a 50% chance of creating a valid PDA.
// Before building/deploying, we find the canonical seed by running 
//      `solana find-program-derived-address <program_id>`
// This is an efficiency optimization. We are using a static seed to create the PDA with no bump.
// We ensure when deploying that the program id is one that only needs the seed above and no bump.
// This is because 
//      (1) create_program_address is not safe if using a user provided bump.
//      (2) find_program_address is expensive and we want to avoid iterations.

use spl_token_2022::solana_program::{{pubkey, pubkey::Pubkey}};

pub const COMPTOKEN_MINT_ADDRESS: Pubkey = pubkey!("{mintAddress}");

pub const TRANSFER_HOOK_ID: Pubkey = pubkey!("{transferHookAddress}");

pub const COMPTO_GLOBAL_DATA_ACCOUNT_BUMP: u8 = {globalDataSeed};
pub const COMPTO_INTEREST_BANK_ACCOUNT_BUMP: u8 = {interestBankSeed};
pub const COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_BUMP: u8 = {verifiedHumanUBIBankSeed};
pub const COMPTO_FUTURE_UBI_BANK_ACCOUNT_BUMP: u8 = {futureUBIBankSeed};\
"""
    write(COMPTO_GENERATED_RS_FILE, file_data)

def generateTransferHookAddressFile(
    comptokenAddress: str, extraAccountMetasSeed: int, mintAddress: str, interestBankAddress: str,
    verifiedHumanUBIBankAddress: str, futureUBIBankAddress: str
):
    print(f"Generating {TRANSFER_HOOK_GENERATED_RS_FILE}...")
    file_data = f"""\
// AUTOGENERATED DO NOT TOUCH
// generated by test/common.py

// A given seed and program id have a 50% chance of creating a valid PDA.
// Before building/deploying, we find the canonical seed by running 
//      `solana find-program-derived-address <program_id>`
// This is an efficiency optimization. We are using a static seed to create the PDA with no bump.
// We ensure when deploying that the program id is one that only needs the seed above and no bump.
// This is because 
//      (1) create_program_address is not safe if using a user provided bump.
//      (2) find_program_address is expensive and we want to avoid iterations.

use spl_token_2022::solana_program::{{pubkey, pubkey::Pubkey}};

pub const COMPTOKEN_ID: Pubkey = pubkey!("{comptokenAddress}");

pub const EXTRA_ACCOUNT_METAS_BUMP: u8 = {extraAccountMetasSeed};
pub const MINT_ADDRESS: Pubkey = pubkey!("{mintAddress}");

pub const COMPTO_INTEREST_BANK_ACCOUNT_PUBKEY: Pubkey = pubkey!("{interestBankAddress}");
pub const COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_PUBKEY: Pubkey = pubkey!("{verifiedHumanUBIBankAddress}");
pub const COMPTO_FUTURE_UBI_BANK_ACCOUNT_PUBKEY: Pubkey = pubkey!("{futureUBIBankAddress}");\
"""
    write(TRANSFER_HOOK_GENERATED_RS_FILE, file_data)

def setGlobalDataPDA(programId: str) -> PDA:
    pda = PDA(programId, "Global Data")
    write(COMPTO_GLOBAL_DATA_ACCOUNT_JSON, json.dumps(pda))
    return pda

def setInterestBankPDA(programId: str) -> PDA:
    pda = PDA(programId, "Interest Bank")
    write(COMPTO_INTEREST_BANK_ACCOUNT_JSON, json.dumps(pda))
    return pda

def setVerifiedHumanUBIBankPDA(programId: str) -> PDA:
    pda = PDA(programId, "Verified Human UBI Bank")
    write(COMPTO_VERIFIED_HUMAN_UBI_BANK_ACCOUNT_JSON, json.dumps(pda))
    return pda

def setFutureUBIBankPDA(programId: str) -> PDA:
    pda = PDA(programId, "Future UBI Bank")
    write(COMPTO_FUTURE_UBI_BANK_ACCOUNT_JSON, json.dumps(pda))
    return pda

def setExtraAccountMetasPDA(programId: str, mint_pubkey: Pubkey) -> PDA:
    pda = PDA(programId, "extra-account-metas", mint_pubkey)
    write(EXTRA_ACCOUNT_METAS_ACCOUNT_JSON, json.dumps(pda))
    return pda

def randAddress() -> str:
    keygen = run("solana-keygen new --no-bip39-passphrase --no-outfile")
    return keygen.split("\n")[2][8:]

def createKeyPair(outfile: Path):
    run(f"solana-keygen new --no-bip39-passphrase --force --silent --outfile {outfile}")

def generateTestUser():
    createKeyPair(TEST_USER_ACCOUNT_JSON)

def generateFiles(comptokenProgramId: str, transferHookId: str, mintAddress: str):
    print("generating files...")
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

    extraAccountMetasSeed = setExtraAccountMetasPDA(transferHookId, Pubkey(mintAddress))["bumpSeed"]
    # test user
    generateTestUser()
    # rust file
    generateComptokenAddressFile(
        globalDataSeed, interestBankSeed, verifiedHumanUBIBankSeed, futureUBIBankSeed, mintAddress, transferHookId
    )
    generateTransferHookAddressFile(
        comptokenProgramId, extraAccountMetasSeed, mintAddress, interestBankAddress, verifiedHumanUBIBankAddress, futureUBIBankAddress
    )
    print("done generating files")

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
    parser.add_argument("--no-build", action="store_false", dest="build", help="skip building, implies --no-generate")
    parser.add_argument("--no-generate", action="store_false", dest="generate", help="skip generating files")

    args = parser.parse_args()
    if not args.build:
        args.generate = False
    return args
