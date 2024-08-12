import { get_default_comptoken_mint, get_default_global_data } from "../accounts.js";
import { Assert } from "../assert.js";
import { run_test, setup_test } from "../generic_test.js";
import { createGetValidBlockhashesInstruction } from "../instruction.js";

async function test_getValidBlockhashes() {
    let accounts = [
        get_default_comptoken_mint(),
        get_default_global_data(),
    ]

    let context = await setup_test(accounts);

    let instructions = [await createGetValidBlockhashesInstruction()];
    let result;

    [context, result] = await run_test("getValidBlockhashes", context, instructions, [context.payer], async (context, result) => {
        let global_data = get_default_global_data();
        const validBlockHashes = { current_block: result.meta.returnData.data.slice(0, 32), announced_block: result.meta.returnData.data.slice(32, 64), };
        Assert.assert(validBlockHashes.announced_block.every((v, i) => v === global_data.data.validBlockhashes.announcedBlockhash[i]), "announced blockhash is globalData default");
        Assert.assert(validBlockHashes.current_block.every((v, i) => v === global_data.data.validBlockhashes.validBlockhash[i]), "valid blockhash is globalData default");
    });
}

(async () => { await test_getValidBlockhashes(); })();