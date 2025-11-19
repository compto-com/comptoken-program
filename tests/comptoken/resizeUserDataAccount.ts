import { default as anchor } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";

import {
    baseProgram,
    createGlobalDataAddedAccount,
    createUserDataAddedAccount,
} from "./utils/accountPreinitHelpers.ts";
import { fetchUserData, fetchUserDataInfo, fetchUserDataSize, getUserDataPda } from "./utils/stateHelpers.ts";
import { prepareTest } from "./utils/utils.ts";

const { BN } = anchor;

function userDataSize(capacity: number): number {
    return Number(baseProgram.constants.userDataSizeWithoutProofs) + capacity * 32;
}

describe("resize_user_data_account", () => {
    describe("Core success path scenarios", () => {
        it("resizes user_data account upward when new size > current", async () => {
            const user = Keypair.generate();
            const accounts = [
                await createGlobalDataAddedAccount(),
                await createUserDataAddedAccount({ userPubkey: user.publicKey, capacity: 2, proofs: [] }),
            ];
            const { provider, program } = await prepareTest(accounts);

            const before = await fetchUserDataInfo(program, user.publicKey);
            expect(before).to.not.be.null;

            const newCap = 7;

            await program.methods
                .resizeUserDataAccount({ newCapacity: new BN(newCap) })
                .accounts({ payer: provider.wallet.publicKey, userWallet: user.publicKey })
                .signers([user])
                .rpc();

            const after = await fetchUserDataInfo(program, user.publicKey);
            expect(after).to.not.be.null;
            expect(after!.data.length).to.equal(userDataSize(newCap));
            expect(after!.data.length).to.be.greaterThan(before!.data.length);
        });

        it("attempting shrink below current size fails", async () => {
            const user = Keypair.generate();
            const proofs = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), new Uint8Array(32).fill(3)];

            const accounts = [
                await createGlobalDataAddedAccount(),
                await createUserDataAddedAccount({ userPubkey: user.publicKey, capacity: 4, proofs }),
            ];

            const { provider, program } = await prepareTest(accounts);

            let threw = false;
            try {
                await program.methods
                    .resizeUserDataAccount({ newCapacity: new BN(2) })
                    .accounts({ payer: provider.wallet.publicKey, userWallet: user.publicKey })
                    .signers([user])
                    .rpc();
            } catch (e: any) {
                threw = true;
                expect(String(e.message || e)).to.match(/invalid|capacity|fail|constraint/i);
            }
            expect(threw, "Expected shrink below current length to fail").to.be.true;
        });

        it("updates lamports to maintain rent exemption after successful resize", async () => {
            const user = Keypair.generate();
            const initialCap = 2;
            const newCap = 10;

            const accounts = [
                await createGlobalDataAddedAccount(),
                await createUserDataAddedAccount({ userPubkey: user.publicKey, capacity: initialCap, proofs: [] }),
            ];

            const { provider, program } = await prepareTest(accounts);

            const before = await fetchUserDataInfo(program, user.publicKey);
            expect(before).to.not.be.null;

            const minRentBefore = await provider.connection.getMinimumBalanceForRentExemption(before!.data.length);

            await program.methods
                .resizeUserDataAccount({ newCapacity: new BN(newCap) })
                .accounts({ payer: provider.wallet.publicKey, userWallet: user.publicKey })
                .signers([user])
                .rpc();

            const after = await fetchUserDataInfo(program, user.publicKey);
            expect(after).to.not.be.null;

            const minRentAfter = await provider.connection.getMinimumBalanceForRentExemption(userDataSize(newCap));
            expect(after!.lamports).to.be.at.least(minRentAfter);
            expect(minRentAfter).to.be.at.least(minRentBefore);
        });

        it("preserves existing serialized data after resize (appends zeroed bytes)", async () => {
            const user = Keypair.generate();
            const p1 = new Uint8Array(32).fill(0xaa);
            const p2 = new Uint8Array(32).fill(0xbb);
            const proofs = [p1, p2];
            const initialCap = 2;
            const newCap = 6;

            const accounts = [
                await createGlobalDataAddedAccount(),
                await createUserDataAddedAccount({ userPubkey: user.publicKey, capacity: initialCap, proofs }),
            ];

            const { provider, program } = await prepareTest(accounts);

            await program.methods
                .resizeUserDataAccount({ newCapacity: new BN(newCap) })
                .accounts({ payer: provider.wallet.publicKey, userWallet: user.publicKey })
                .signers([user])
                .rpc();

            const userData = await fetchUserData(program, user.publicKey);
            expect(userData.proofs.length).to.equal(2);
            expect(new Uint8Array(userData.proofs[0][0])).to.deep.equal(p1);
            expect(new Uint8Array(userData.proofs[1][0])).to.deep.equal(p2);
        });

        it("allows multiple incremental resizes within allowed limits", async () => {
            const user = Keypair.generate();
            const accounts = [
                await createGlobalDataAddedAccount(),
                await createUserDataAddedAccount({ userPubkey: user.publicKey, capacity: 1, proofs: [] }),
            ];

            const { provider, program } = await prepareTest(accounts);

            await program.methods
                .resizeUserDataAccount({ newCapacity: new BN(5) })
                .accounts({ payer: provider.wallet.publicKey, userWallet: user.publicKey })
                .signers([user])
                .rpc();

            const sizeFirst = await fetchUserDataSize(program, user.publicKey);
            expect(sizeFirst).to.equal(userDataSize(5));

            await program.methods
                .resizeUserDataAccount({ newCapacity: new BN(8) })
                .accounts({ payer: provider.wallet.publicKey, userWallet: user.publicKey })
                .signers([user])
                .rpc();

            const sizeSecond = await fetchUserDataSize(program, user.publicKey);
            expect(sizeSecond).to.equal(userDataSize(8));
        });
    });

    describe("Boundary & edge cases", () => {
        it.skip("fails when requested new size exceeds solana max increase limit", () => {});
        it.skip("handles resize to exactly current size gracefully (no changes)", () => {});
        it.skip("succeeds resizing near size limit (just below MAX)", () => {});
        it.skip("properly zero-fills newly allocated region for deterministic data", () => {});
    });

    describe("Authorization / validation failures", () => {
        it.skip("fails when caller missing required authority signer (e.g. owner/global admin)", () => {});
        it.skip("fails with incorrect PDA seeds for user_data account (address mismatch)", () => {});
        it.skip("fails when user_data account provided is not the expected PDA", () => {});
        it.skip("fails when user_data account is not mutable", () => {});
        it.skip("fails when system_program account missing", () => {});
    });

    describe("Rent & lamports accounting", () => {
        it.skip("charges correct additional lamports for increased size (rent delta calculation)", () => {});
        it.skip("does not overcharge when resizing multiple times in same transaction batch (if supported)", () => {});
        it.skip("refunds excess lamports on shrink attempt (if shrink path implemented)", () => {});
        it.skip("records lamports delta in emitted logs/event (if events present)", () => {});
    });

    describe("Event & history recording", () => {
        it.skip("emits ResizeUserDataAccount event with old_size and new_size", () => {});
        it.skip("appends audit trail entry when history buffer feature enabled", () => {});
    });

    describe("Error messaging specificity", () => {
        it.skip("returns descriptive error for exceeding max size", () => {});
        it.skip("returns descriptive error for unauthorized caller", () => {});
        it.skip("returns descriptive error for PDA seed mismatch", () => {});
    });

    describe("Integration / composite scenarios", () => {
        it.skip("resize followed by data write succeeds and data persists", () => {});
        it.skip("resize then subsequent instruction in same transaction sees new size", () => {});
        it.skip("collect logic unaffected after user_data resize (regression guard)", () => {});
    });
});
