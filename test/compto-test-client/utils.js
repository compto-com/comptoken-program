/**
 * @param {number | bigint} int 
 * @returns {Uint8Array}
 */
export function bigintAsU64ToBytes(int) {
    int = BigInt(int);
    let arr = new Uint8Array(8);
    for (let i = 0; int > 0n; ++i) {
        arr[i] = Number(int & 255n);
        int >>= 8n;
    }
    return arr;
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

export function* take(num, iterable) {
    let i = 0;
    for (const elem of iterable) {
        if (i == num) {
            return;
        }
        yield elem
        ++i;
    }
}

export function clamp(min, val, max) {
    return min > val ? min : (val < max ? val : max);
}
