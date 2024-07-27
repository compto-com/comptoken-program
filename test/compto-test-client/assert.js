
export class AssertionError extends Error {
    cause;
    notes;
    msg;

    /**
     * 
     * @param {string} cause 
     * @param {string[]} notes 
     * @param {string} msg 
     */
    constructor(cause, notes, msg) {
        let name = "Assertion Error";
        let note = notes.map((p) => "\n    note: " + p).join("");
        let msg_ = "\n    msg:\t'" + (msg === undefined ? "" : msg) + "'"
        let message = name + ": " + cause + note + msg_ + "\n";
        super(message);
        this.cause = cause;
        this.notes = notes;
        this.msg = msg;
    }
}

export class Assert {
    /**
     * 
     * @param {T} left 
     * @param {T} right 
     * @param {string} msg
     */
    static assertEqual(left, right, msg) {
        if (left !== right) {
            throw new AssertionError("left should equal right", [
                "left is\t'" + left.toString() + "'",
                "right is\t'" + right.toString() + "'",
            ], msg);
        }
    }

    /**
     * 
     * @param {T} left 
     * @param {T} right 
     * @param {string} msg
     */
    static assertNotEqual(left, right, msg) {
        if (left === right) {
            throw new AssertionError("left should not equal right", [
                "left is '" + left.toString() + "'",
                "right is '" + right.toString() + "'",
            ], msg);
        }
    }

    /**
     * 
     * @param {boolean} cond 
     * @param {string} msg
     */
    static assert(cond, msg) {
        if (!cond) {
            throw new AssertionError("cond should be true", [], msg);
        }
    }

    /**
     * 
     * @param {any} obj 
     * @param {string} msg
     */
    static assertNotNull(obj, msg) {
        if (obj === null) {
            throw new AssertionError("obj should not be null", ["obj was null"], msg);
        } else if (obj === undefined) {
            throw new AssertionError("obj should not be null", ["obj was undefined"], msg);
        } else if (typeof obj === "undefined") {
            throw new AssertionError("obj should not be null", ["typeof obj was \"undefined\""], msg);
        }
    }
}