import os 
import subprocess
from pathlib import Path
import json

test_path = Path(__file__).parent
project_path = test_path.parent
cache_path = test_path / ".cache"
compto_md5_json = cache_path / "compto_md5sum.json"
compto_program_id_json = cache_path / "compto_program_id.json"
compto_so = project_path / "target/deploy/compto_token.so"
compto_token_id_json = project_path / "compto_token_id.json"
compto_test_account = cache_path / "compto_test_account.json"
compto_mint_authority_json = cache_path / "compto_mint_authority.json"


# ========= JSON =========

def getTokenAddress():
    try:
        return json.loads(compto_token_id_json.read_text()).get("commandOutput").get("address")
    except:
        return None

def getProgramId():
    try:
        return json.loads(compto_program_id_json.read_text()).get("programId")
    except:
        return None

# ==== SOLANA COMMANDS ====

def createToken():
    run(f"spl-token create-token -v --output json > {compto_token_id_json}")

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

# ==== SHELL COMMANDS ====

def build():
    run("cargo build-sbf", project_path)
    
def getComptoMd5():
    return run(f"md5sum {compto_so}", project_path).split()[0]

# ========================

def deployIfNeeded():
    # Only deploy if the md5sum of the program has changed
    md5sum = getComptoMd5()
    if not compto_md5_json.exists() or json.loads(compto_md5_json.read_text())["md5sum"] != md5sum:
        compto_md5_json.write_text(json.dumps({"md5sum": md5sum}))
        deploy()
    else:
        print("Program has not changed, skipping deploy")


def hardcodeComptoAddress():
    compto_token_id = getTokenAddress()
    compto_program_source = project_path / "src/compto_token.rs"
    
    # place the new token address in the source code of the program
    with open(compto_program_source, "r") as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if "static COMPTO_TOKEN_ADDRESS: Pubkey = pubkey!(" in line:
            lines[i] = f"static COMPTO_TOKEN_ADDRESS: Pubkey = pubkey!(\"{compto_token_id}\");\n"
            break
    with open(compto_program_source, "w") as f:
        f.writelines(lines)
        
def createTokenIfNeeded():
    if getTokenAddress() is None:
        createToken()
        
   

def run(command, cwd=None):
    result = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        raise Exception(f"Failed to run command! command: {command} stdout: {result.stdout} stderr: {result.stderr}")
    return result.stdout


def runTestClient():
    return run("node compto-test-client/test_client.js", test_path)

if __name__ == "__main__":
    print("Creating Compto Token...")
    createToken()
    print("Hardcoding Compto Program with Compto Token Address...")
    hardcodeComptoAddress()
    print("Creating Token Account...")
    createComptoAccount()
    print("Building...")
    build()
    print("Deploying...")
    deploy()
    print("Running Test Client...")
    output = runTestClient()
    print(output)
    test_account = getPubkey(compto_test_account)
    print(f"Test Account {test_account} Balance: {getAccountBalance(test_account)}")
    
    
    