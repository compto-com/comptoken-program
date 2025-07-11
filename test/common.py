import argparse
import json
import os
import platform
import signal
import subprocess
from contextlib import contextmanager
from functools import reduce
from pathlib import Path
from time import sleep
from types import TracebackType
from typing import Any, Mapping, Self, Type


def _alwaysFlush() -> None:
    """Force flush all print statements immediately, unless explicitly set to not flush."""
    # This is a workaround for the fact that the ci tests don't flush the output, so if
    # they hang, we don't see the output.
    import builtins

    def printWrapper(*args: object, sep: str | None = " ", end: str | None = "\n", flush: bool = True, file: None = None) -> None:
        import sys
        builtins._original_print(f"[{sys.argv[0]}]", *args, flush=flush, sep=sep, end=end, file=file) # type: ignore 

    builtins._original_print = builtins.print # type: ignore
    builtins.print = printWrapper

_alwaysFlush()

TEST_PATH = Path(__file__).parent
PROJECT_PATH = TEST_PATH.parent
DEPLOY_PATH = PROJECT_PATH / "target/deploy"
COMPTOKEN_SRC_PATH = PROJECT_PATH / "comptoken"
TRANSFER_HOOK_SRC_PATH = PROJECT_PATH / "comptoken-transfer-hook"
CACHE_PATH = TEST_PATH / ".cache"
LOGS_PATH = CACHE_PATH / "logs"
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
        self._kwargs.setdefault("stdout", subprocess.PIPE)
        self._kwargs.setdefault("stderr", subprocess.PIPE)
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
            self._process.wait()

        if exc_type is not None:
            stdout, stderr = self.getOutput()
            print(f"stdout: {stdout}")
            print(f"stderr: {stderr}")
        return False

    def checkIfProcessRunning(self):
        return self._process is not None and self._process.poll() is None

    def getOutput(self) -> tuple[str, str]:
        if self._process is None:
            raise ValueError("Process not started")
        if self.checkIfProcessRunning():
            raise ValueError("Process is still running")
        try:
            stdout, stderr = self._process.communicate(timeout=5)
            return stdout.decode("utf-8"), stderr.decode("utf-8")
        except subprocess.TimeoutExpired:
            return "Timeout", "Timeout"

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

@contextmanager
def createTestValidator(reset: bool, verbosity: int = 0):
    createDirIfNotExists(CACHE_PATH)
    cmd = f"solana-test-validator{' --reset' if reset else ''}"
    with BackgroundProcess(
        cmd,
        shell=True,
        cwd=CACHE_PATH,
        preexec_fn=os.setsid,
    ) as validator:
        waitTillValidatorReady(validator, verbosity)
        yield validator

def checkIfValidatorReady(validator: BackgroundProcess, verbosity: int) -> bool:
    if not validator.checkIfProcessRunning():
        return False
    try:
        run("solana ping -u localhost -c 1")
        return True
    except Exception as e:
        if verbosity > 1:
            print(f"Validator not ready: {e}")
        return False

def waitTillValidatorReady(validator: BackgroundProcess, verbosity: int):
    print("Checking Validator Ready...")
    MAX_ATTEMPTS = 10
    attempts = 0
    while not checkIfValidatorReady(validator, verbosity):
        if attempts >= MAX_ATTEMPTS:
            print("Validator Timeout, Exiting...")
            exit(1)
        print("Validator Not Ready")
        sleep(1)
        attempts += 1
        if attempts + 1 == MAX_ATTEMPTS:
            # extra verbose mode for last attempt
            verbosity += 1
    print("Validator Ready")

def createDirIfNotExists(path: str | Path):
    run(f"mkdir -p {path}")

def is_running_on_wsl():
    return 'microsoft-standard' in platform.release()

def is_windows_subdirectory_in_wsl(path: Path) -> bool:
    return is_running_on_wsl() and str(path.absolute()).startswith("/mnt/")

def generateDirectories(args: argparse.Namespace):
    createDirIfNotExists(CACHE_PATH)
    createDirIfNotExists(COMPTOKEN_GENERATED_PATH)
    createDirIfNotExists(TRANSFER_HOOK_GENERATED_PATH)
    if hasattr(args, "log_directory") and args.log_directory:
        createDirIfNotExists(args.log_directory)
        createDirIfNotExists(args.log_directory / "comptoken-tests")
        createDirIfNotExists(args.log_directory / "transfer-hook-tests")

def run(
    command: str | list[str],
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
    timeout: float | None = None,
    verbosity: int = 0
) -> str:
    try:
        result = subprocess.run(
            command, shell=True, cwd=cwd, capture_output=True, text=True, env=env, timeout=timeout
        )
    except subprocess.TimeoutExpired as e:
        output = ''
        if verbosity >= 1:
            output = "\n\tOutput:\n"
            if hasattr(e, "output") and e.output:
                output += f'{e.output}'
            if hasattr(e, "stderr") and e.stderr:
                try:
                    output += f"\n  stderr: {e.stderr.decode('utf-8', errors='replace')}"
                except Exception as e:
                    output += f"\n  stderr: Error decoding stderr: {e}"
        raise SubprocessFailedException(
            f"Failed to run command! command: '{command}' timed out. {output}"
        )
    
    if result.returncode != 0:
        raise SubprocessFailedException(
            f"Failed to run command! command: '{command}' stdout: {result.stdout} stderr: {result.stderr}"
        )
    return result.stdout.rstrip()

def build(package: str | None, features: list[str] = []):
    if package is None:
        print("No package specified, building all packages")
        print("Building...")
    else:
        print(f"Building {package}...")
    features_flag = "" if len(features) == 0 else f"--features \"{' '.join(features)}\""
    package_flag = "" if package is None else f"--package {package}"
    run(f'cargo build-sbf {features_flag} -- -v {package_flag}', PROJECT_PATH)
    print(f"Done Building {package}")

def buildCompto(features: list[str] = []):
    build("comptoken", features)

def buildTransferHook(features: list[str] = []):
    build("comptoken-transfer-hook", features)

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

use solana_program::{{pubkey, pubkey::Pubkey}};

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

use solana_program::{{pubkey, pubkey::Pubkey}};

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

def createKeyPair(outfile: Path, force: bool = False):
    try:
        run(f"solana-keygen new --no-bip39-passphrase {'--force' if force else ''} --silent --outfile {outfile}")
    except SubprocessFailedException as e:
        not_overwrite_error = lambda: e.args[0].find("Refusing to overwrite") == -1
        if not_overwrite_error() or force:
            raise Exception(f"Failed to create keypair at {outfile}, file already exists")

def generateTestUser(force: bool = False):
    createKeyPair(TEST_USER_ACCOUNT_JSON, force)

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
