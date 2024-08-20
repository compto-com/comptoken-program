/**
 * @template T
 * @param {T | null | undefined} val
 * @returns {T | null}
 */
export function toOption(val) {
    if (val === undefined || typeof val === "undefined") {
        return null;
    }
    return val;
}

/**
 * @template T
 * @param {T | null} opt_val
 * @param {() => T} fn
 * @returns {T} opt_val if it is not null or result of calling fn
 */
export function getOptionOr(opt_val, fn) {
    if (opt_val === null) {
        return { option: 0, val: fn() };
    }
    return { option: 1, val: opt_val };
}

export function bigintAsU64ToBytes(int) {
    let arr = new Array(8);
    for (let i = 0; int > 0n; ++i) {
        arr[i] = Number(int & 255n);
        int >>= 8n;
    }
    return arr;
}

/**
 * @param {number} num
 * @returns {number[]}
 */
export function numAsU16ToLEBytes(num) {
    let buffer = Buffer.alloc(2);
    buffer.writeUInt16LE(num);
    return Array.from({ length: 2 }, (v, i) => buffer.readUint8(i));
}

/**
 * @param {number} num
 * @returns {number[]}
 */
export function numAsDoubleToLEBytes(num) {
    let buffer = Buffer.alloc(8);
    buffer.writeDoubleLE(num);
    return Array.from({ length: 8 }, (v, i) => buffer.readUint8(i));
}

/**
 * @template T
 * @param {T[]} bytes
 * @param {number} chunk_size
 * @returns {T[][]}
 */
function chunkArray(bytes, chunk_size) {
    let len = bytes.length / chunk_size;
    let arr = new Array(len);
    for (let i = 0; i < len; ++i) {
        arr[i] = bytes.subarray(i * chunk_size, i * chunk_size + chunk_size);
    }
    return arr;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number[]}
 */
export function LEBytesToDoubleArray(bytes) {
    return chunkArray(bytes, 8).map((elem) => new DataView(elem.buffer.slice(elem.byteOffset)).getFloat64(0, true));
}

/**
 * @param {Uint8Array} bytes
 * @returns {Uint8Array[]}
 */
export function LEBytesToBlockhashArray(bytes) {
    return chunkArray(bytes, 32);
}

export function isArrayEqual(left, right) {
    if (left.length != right.length) {
        return false;
    }
    for (let i = 0; i < left.length; ++i) {
        if (left[i] != right[i]) {
            return false;
        }
    }
    return true;
}

/**
 * @template T
 * @param {Iterable<T>} iterable 
 * @param {number} start 
 * @param {number} step
 * @yields {index: number, value: T}
 */
export function* enumerate(iterable, start = 0, step = 1) {
    let index = start;
    for (const value of iterable) {
        yield { index, value };
        index += step;
    }
}

/**
 * @param  {...Iterable} iterables 
 */
export function* zip(...iterables) {
    let iterators = iterables.map(it => it[Symbol.iterator]());
    while (true) {
        let result = [];
        for (let it of iterators) {
            let next = it.next();
            if (next.done) {
                return;
            }
            result.push(next.value);
        }
        yield result;
    }
}