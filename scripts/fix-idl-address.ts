import fs from "fs";
import path from "path";

function getAnchorTomlAddress(): string | null {
    const anchorTomlPath = path.resolve(process.cwd(), "Anchor.toml");
    try {
        const toml = fs.readFileSync(anchorTomlPath, "utf8");
        // Simple parse: look for [programs.localnet] then the line starting with comptoken = "..."
        const localnetIdx = toml.indexOf("[programs.localnet]");
        const endLocalnetIdx = toml.indexOf("[", localnetIdx + 1);
        if (localnetIdx === -1) return null;
        const section = toml.slice(localnetIdx, endLocalnetIdx === -1 ? undefined : endLocalnetIdx);
        const match = section.match(/\bcomptoken\s*=\s*["']([^"]+)["']/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

function getDeclareIdAddress(): string | null {
    const libPath = path.resolve(process.cwd(), "programs", "comptoken", "src", "lib.rs");
    try {
        const lib = fs.readFileSync(libPath, "utf8");
        const match = lib.match(/declare_id!\("([^"]+)"\)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

function main() {
    const idlPath = path.resolve(process.cwd(), "target", "idl", "comptoken.json");
    if (!fs.existsSync(idlPath)) {
        console.error("IDL not found at", idlPath);
        process.exit(1);
    }
    const idlRaw = fs.readFileSync(idlPath, "utf8");
    let idl;
    try {
        idl = JSON.parse(idlRaw);
    } catch (e) {
        console.error("Failed to parse comptoken.json:", e);
        process.exit(1);
    }

    const desired = getAnchorTomlAddress() || getDeclareIdAddress();
    if (!desired) {
        console.error("Could not determine desired comptoken address from Anchor.toml or declare_id!");
        process.exit(1);
    }

    if (idl.address !== desired) {
        console.log(`Fixing comptoken IDL address: ${idl.address} -> ${desired}`);
        idl.address = desired;
        fs.writeFileSync(idlPath, JSON.stringify(idl, null, 2) + "\n", "utf8");
    } else {
        console.log("comptoken IDL address already correct:", desired);
    }

    // Also fix generated TS type if present
    const tsPath = path.resolve(process.cwd(), "target", "types", "comptoken.ts");
    if (fs.existsSync(tsPath)) {
        let ts = fs.readFileSync(tsPath, "utf8");
        // Replace any hardcoded program ID occurrences
        const replaced = ts.replace(/("|')9TMVfMJs6qyu8jnc7TJfAWhn81Ju2uSRj4uYqLHyKXnh("|')/g, `'${desired}'`);
        if (replaced !== ts) {
            console.log("Updated comptoken.ts program address to", desired);
            fs.writeFileSync(tsPath, replaced, "utf8");
        }
    }
}

main();
