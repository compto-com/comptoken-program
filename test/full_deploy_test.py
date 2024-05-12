import os 
import subprocess
from pathlib import Path
import json

test_path = Path(__file__).parent
project_path = test_path.parent
cache_path = test_path / ".cache"
compto_md5_json = cache_path / "compto_md5sum.json"
compto_program_id_json = cache_path / "compto_program_id.json"
compto_so = project_path / "target/deploy/comptoken.so"
comptoken_id_json = cache_path / "comptoken_id.json"
compto_test_account = cache_path / "compto_test_account.json"
compto_mint_authority_json = cache_path / "compto_mint_authority.json"
compto_program_source = project_path / "src/comptoken.rs"
compto_static_pda = cache_path / "compto_static_pda.json"

# ==== SOLANA COMMANDS ====
def getProgramId():
    return run(f"solana address -k target/deploy/comptoken-keypair.json")

def createToken():
    run(f"spl-token create-token -v --output json > {comptoken_id_json}")

def createKeyPair(outfile):
    run(f"solana-keygen new --no-bip39-passphrase --force --silent --outfile {outfile}")

def createComptoAccount():
    createKeyPair(compto_test_account)
    run(f"spl-token create-account {getTokenAddress()} {compto_test_account}")
    
def getPubkey(path):
    return run(f"solana-keygen pubkey {path}")
    
def getAccountBalance(pubkey):
    return run(f"solana balance {pubkey}") 

def deploy():
    run(f"solana program deploy -v {compto_so} --output json > {compto_program_id_json}")

def setComptoMintAuthority():
    result = run(f"spl-token authorize {getTokenAddress()} mint {getProgramId()} --output json > {compto_mint_authority_json}")

def getCurrentMintAuthority():
    return json.loads(run(f"spl-token display {getTokenAddress()} --output json")).get("mintAuthority")

def getStaticPda():
    return json.loads(compto_static_pda.read_text())

# ==== SHELL COMMANDS ====
def build():
    run("cargo build-sbf", project_path)
    
def getComptoMd5():
    return run(f"md5sum {compto_so}", project_path).split()[0]
# ========================

def checkIfProgamIdChanged():
    # Only deploy if the program id has changed
    real_program_id = getProgramId()
    cached_program_id = json.loads(compto_program_id_json.read_text())["programId"]
    if real_program_id == cached_program_id:
        return False
    else:
        return True

def deployIfNeeded():
    # Only deploy if the md5sum of the program has changed
    md5sum = getComptoMd5()
    if not compto_md5_json.exists() or json.loads(compto_md5_json.read_text())["md5sum"] != md5sum:
        compto_md5_json.write_text(json.dumps({"md5sum": md5sum}))
        deploy()
    else:
        print("Program has not changed, skipping deploy.")

def hardcodeComptoAddress():
    comptoken_id = getTokenAddress()
    # place the new token address in the source code of the program
    lines = open(compto_program_source, "r").readlines()
    for i, line in enumerate(lines):
        if "static COMPTOKEN_ADDRESS: Pubkey = pubkey!(" in line:
            if comptoken_id not in line:
                print("Hardcoding comptoken address...")
                lines[i] = f"static COMPTOKEN_ADDRESS: Pubkey = pubkey!(\"{comptoken_id}\");\n"
                open(compto_program_source, "w").writelines(lines)
            break

def hardcodeComptoStaticSeed():
    run(f"solana find-program-derived-address {getProgramId()} --output json > {compto_static_pda}")
    seed = getStaticPda()["bumpSeed"]
    lines = open(compto_program_source, "r").readlines()
    for i, line in enumerate(lines):
        if "static COMPTO_STATIC_ADDRESS_SEED: u8 = " in line:
            if str(seed) not in line:
                print("Hardcoding compto static seed...")
                lines[i] = f"static COMPTO_STATIC_ADDRESS_SEED: u8 = {seed};\n"
                open(compto_program_source, "w").writelines(lines)
            break

def getTokenAddress():
    try:
        return json.loads(comptoken_id_json.read_text()).get("commandOutput").get("address") 
    except:
        return None
    

def createTokenIfNeeded():
    if getTokenAddress() is None:
        print("Creating new Comptoken...")
        createToken()
    # If a new program id is created, the mint authority will not match.
    # Rather than have the old mint authority sign over the new authority, we will just create a new token.
    # if getCurrentMintAuthority() != getStaticPda()["address"]:
    #     print("Mint Authority doesn't match. Creating new Comptoken...")
    #     createToken()
    # ^^^ commented out in favor of checking if the program id has changed
    if checkIfProgamIdChanged():
        print("Program ID has changed. Creating new Comptoken...")
        createToken()
    else:
        print("Using existing Comptoken...")

def run(command, cwd=None):
    result = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        raise Exception(f"Failed to run command! command: {command} stdout: {result.stdout} stderr: {result.stderr}")
    return result.stdout.rstrip()

def runTestClient():
    return run("node compto-test-client/test_client.js", test_path)

if __name__ == "__main__":
    print("Cargo Build...")
    run("cargo build-sbf", project_path)
    createTokenIfNeeded()
    print("Checking Compto Program for hardcoded Comptoken Address and static seed...")
    hardcodeComptoAddress()
    hardcodeComptoStaticSeed()
    print("Creating Token Account...")
    createComptoAccount()
    print("Building...")
    build()
    print("Deploying...")
    deployIfNeeded()
    print("Running Test Client...")
    output = runTestClient()
    print(output)
    test_account = getPubkey(compto_test_account)
    print(f"Test Account {test_account} Balance: {getAccountBalance(test_account)}")
    
    
    