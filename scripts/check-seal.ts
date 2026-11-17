// Run: node --experimental-strip-types scripts/check-seal.ts
import assert from "node:assert/strict";

process.env.COOKIE_SECRET = "test-secret-that-is-at-least-32-characters-long";
const { seal, unseal } = await import("../app/api/connect/seal.ts");

const sealed = seal("cal_google", { refresh: "1//abc" });
assert.deepEqual(unseal("cal_google", sealed), { refresh: "1//abc" }, "round trip");
assert.equal(unseal("cal_microsoft", sealed), null, "bound to its cookie name");

const bytes = Buffer.from(sealed, "base64url");
bytes[bytes.length - 1] ^= 1;
assert.equal(unseal("cal_google", bytes.toString("base64url")), null, "tampering is rejected");
assert.equal(unseal("cal_google", "garbage"), null);
assert.equal(unseal("cal_google", undefined), null);

process.env.COOKIE_SECRET = "a-different-secret-also-32-characters-long!";
assert.equal(unseal("cal_google", sealed), null, "wrong secret is rejected");
console.log("seal ok");
