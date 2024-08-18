import { format, parseArgs } from "node:util";

export const args = parseArgs({
    options: {
        verbose: { type: "boolean", default: [], multiple: true, short: "v" },
    },
});
args.values.verbose = args.values.verbose.length;

const log_level = args.values.verbose;

export const print = console.log;
export const log = log_level > 0 ? (...data) => console.log("log:   ", format(...data)) : () => { };
export const debug = log_level > 1 ? (...data) => console.log("debug: ", format(...data)) : () => { };
export const info = log_level > 2 ? (...data) => console.log("info:  ", format(...data)) : () => { };
export const warn = log_level > 3 ? (...data) => console.log("warn:  ", format(...data)) : () => { };
export const error = log_level > 4 ? (...data) => console.log("error: ", format(...data)) : () => { };