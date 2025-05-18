
export class AssertionError extends Error {
    cause;
    notes;
    msg;

    /**
     * 
     * @param {string}   cause 
     * @param {string[]} notes 
     * @param {string}   msg 
     */
    constructor(cause, notes = [], msg = "") {
        let message = AssertionError.makeMessage(cause, notes, msg);
        super(message);
        this.cause = cause;
        this.notes = notes;
        this.msg = msg;
    }

    /**
     * @param {string} cause
     * @param {string[]} notes
     * @param {string} msg
     * @returns {string}
     */
    static makeMessage(cause, notes, msg) {
        let note = notes.map((p) => `\n    note: ${p}`).join("");
        let msg_ = `\n    msg:\t'${msg}'`;
        return `AssertionError: ${cause}${note}${msg_}\n`;
    }

    /**
     * @param {string} note
     */
    addNote(note) {
        this.notes.push(note);
        this.message = AssertionError.makeMessage(this.cause, this.notes, this.msg);
        return this;
    }
}

export class Assert {
    /**
     * @template T
     * @param {T} left 
     * @param {T} right 
     * @param {string} msg
     */
    static assertEqual(left, right, msg) {
        if (left !== right) {
            throw new AssertionError("left should equal right", [
                `left is '${left}'`,
                `right is '${right}'`,
            ], msg);
        }
    }

    /**
     * @template T
     * @param {T} left 
     * @param {T} right 
     * @param {string} msg
     */
    static assertNotEqual(left, right, msg) {
        if (left === right) {
            throw new AssertionError("left should not equal right", [
                `left is '${left}'`,
                `right is '${right}'`,
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
     * @template T
     * @param {T | null | undefined} obj 
     * @param {string} msg
     * @returns {asserts obj is T}
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