import { default as anchor, Program, type Provider } from "@coral-xyz/anchor";
import type { IdlType, IdlTypeDefined } from "@coral-xyz/anchor/dist/esm/idl.js";
import { PublicKey } from "@solana/web3.js";
const { BN } = anchor;
const { bs58 } = anchor.utils.bytes;

function getConstants<Idl extends anchor.Idl>(program: Program<Idl>): Constants<Program<Idl>["idl"]["constants"]> {
    const rawConstants = program.idl.constants;
    if (!rawConstants) {
        return {} as Constants<Program<Idl>["idl"]["constants"]>;
    }
    const constants: Constants<Program<Idl>["idl"]["constants"]> = {} as any;
    for (const constant of rawConstants) {
        constants[constant.name] = constantToValue(constant);
    }
    return constants;
}

function constantToValue(constant: {
    name: string;
    type: IdlType;
    value: string;
}): number | string | anchor.BN | Uint8Array | PublicKey {
    switch (constant.type) {
        // potentially too big for number
        case "u64":
        case "i64":
        case "u128":
        case "i128":
        case "u256":
        case "i256":
            return new BN(constant.value);

        case "string":
            return constant.value;

        case "pubkey":
            return new PublicKey(constant.value);

        case "bytes":
            return Uint8Array.from(JSON.parse(constant.value));

        case "f64":
        case "f32":
            return parseFloat(constant.value);

        case "u8":
        case "i8":
        case "u16":
        case "i16":
        case "u32":
        case "i32":
            return parseInt(constant.value);

        default:
            if (typeof constant.type === "object" && "defined" in constant.type) {
                return constantDefinedToValue({ ...constant, type: constant.type });
            }
            throw new Error(`Unknown constant type: ${JSON.stringify(constant.type)}`);
    }
}

function constantDefinedToValue(constant: { name: string; type: IdlTypeDefined; value: string }): any {
    switch (constant.type.defined.name) {
        case "hash": {
            // Hash(<hash in base64?>)
            const buf = bs58.decode(constant.value.slice(5, -1));
            return Uint8Array.from(buf);
        }
    }
    throw new Error(`Unknown defined constant type: ${constant.type.defined.name}`);
}

type Constants<ConstantsType extends Program<anchor.Idl>["idl"]["constants"]> = {
    [key in ConstantsType[number] as key["name"]]: key extends {
        type: "u64" | "i64";
    }
        ? bigint
        : key extends {
              type: "string";
          }
        ? string
        : key extends {
              type: "bytes";
          }
        ? Uint8Array
        : key extends {
              type: "f64" | "f32";
          }
        ? number
        : key extends {
              type: "u8" | "i8" | "u16" | "i16" | "u32" | "i32";
          }
        ? number
        : never;
};

export type ProgramWithConstants<Idl extends anchor.Idl> = Program<Idl> & {
    constants: Constants<Program<Idl>["idl"]["constants"]>;
};

export function getProgramWithConstants<Idl extends anchor.Idl>(
    idl: Idl,
    provider: Provider,
): ProgramWithConstants<Idl> {
    const programWithConstants = new Program<Idl>(idl, provider) as ProgramWithConstants<Idl>;
    programWithConstants.constants = getConstants(programWithConstants);
    return programWithConstants;
}
