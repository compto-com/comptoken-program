import os
import sys
from argparse import Namespace
from contextlib import contextmanager

from common import *

ANSI_GREEN = "\033[92m"
ANSI_RED = "\033[91m"
ANSI_RESET = "\033[0m"

def runTest(args: Namespace, file: str) -> bool:
    print(f"running {file}")
    env = os.environ
    env["SBF_OUT_DIR"] = str(PROJECT_PATH / "target/deploy/")
    node = ("node --trace-warnings" if args.verbose >= 2 else "node")
    verbosity = "" if args.verbose == 0 else "-" + "v" * args.verbose
    command = f"{node} compto-test-client/{file} {verbosity}"
    if args.verbose >= 2:
        print(f"command is '{command}'")
    try:
        stdout = run(command, cwd=TEST_PATH, env=env, timeout=20)
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
    
    args = parser.parse_args()
    if not args.build:
        args.generate = False
    return args

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
        # commented out until WorldCoin integration is implemented
        #"comptoken-tests/verifyHuman",
    ]

    args = parseArgs()
    generateDirectories(args)
    if args.build:
        from build_comptoken_program import build, parseArgs as parseBuildArgs
        buildArgsList:list[str] = []
        if args.verbose:
            buildArgsList.append(f"-{'v' * args.verbose}")
        buildArgsList.extend([f"--skip", "create-token"])
        if not args.generate:
            buildArgsList.append('generate')
        if args.log_directory is not None:
            buildArgsList.extend(['--log-directory', f'{str(args.log_directory)}'])
        buildArgsList.extend(['--features', 'testmode'])
        buildArgs = parseBuildArgs(buildArgsList)
        
        build(buildArgs)
    else:
        print("skipping generating files")
        print("skipping building")

    runTests(args, tests)
