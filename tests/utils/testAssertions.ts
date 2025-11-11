import { expect } from "chai";

import type { Comptoken } from "../../target/types/comptoken.ts";
import type { GlobalDataAccountData } from "./accountPreinitHelpers.ts";
import { getHistoryLength, getHistoryPosition } from "./stateHelpers.ts";
import type { ProgramWithConstants } from "./typeHelpers.ts";

export function expectHistoryAdvancedBy(
    beforeGlobal: GlobalDataAccountData,
    afterGlobal: GlobalDataAccountData,
    program: ProgramWithConstants<Comptoken>,
    delta: number,
) {
    const historyLen = getHistoryLength(program);
    const before = getHistoryPosition(beforeGlobal);
    const after = getHistoryPosition(afterGlobal);
    expect(after).to.equal((before + delta) % historyLen);
}

export function expectAlmostEqual(actual: number, expected: number, tol = 3, message?: string) {
    expect(Math.abs(actual - expected), message ?? `Expected ${actual} ~= ${expected} ±${tol}`).to.be.lessThanOrEqual(
        tol,
    );
}
