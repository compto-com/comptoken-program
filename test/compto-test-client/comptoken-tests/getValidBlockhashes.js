import { get_default_comptoken_mint, get_default_global_data } from "../accounts.js";
import { Assert } from "../assert.js";
import { run_test, setup_test } from "../generic_test.js";
import { createGetValidBlockhashesInstruction } from "../instruction.js";
import { isArrayEqual } from "../utils.js";

async function test_getValidBlockhashes() {
    const original_global_data_account = get_default_global_data()
    const existing_accounts = [get_default_comptoken_mint(), original_global_data_account];

    let context = await setup_test(existing_accounts);

    let instructions = [await createGetValidBlockhashesInstruction()];
    let result;

    [context, result] = await run_test("getValidBlockhashes", context, instructions, [context.payer], false, async (context, result) => {
        const final_valid_blockhashes = {
            current_block: result.meta.returnData.data.slice(0, 32),
            announced_block: result.meta.returnData.data.slice(32, 64)
        };
        const original_valid_blockhashes = original_global_data_account.data.validBlockhashes;
        Assert.assert(
            isArrayEqual(final_valid_blockhashes.announced_block, original_valid_blockhashes.announcedBlockhash),
            "announced blockhash is globalData default"
        );
        Assert.assert(
            isArrayEqual(final_valid_blockhashes.current_block, original_valid_blockhashes.validBlockhash),
            "valid blockhash is globalData default"
        );
    });
}

(async () => { await test_getValidBlockhashes(); })();