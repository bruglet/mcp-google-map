import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMatrixLimit, estimateMatrixUnits } from "../src/services/requestAccounting.js";
import { UsageLedger } from "../src/services/usageLedger.js";

test("matrix accounting is origins times destinations and guards before fan-out", () => {
  assert.equal(estimateMatrixUnits(4, 6), 24);
  assert.doesNotThrow(() => assertMatrixLimit(4, 6, 24));
  assert.throws(() => assertMatrixLimit(5, 5, 24), /25 elements/);
});

test("ledger warnings do not block an invocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-google-map-ledger-"));
  const file = join(directory, "usage.json");
  try {
    const ledger = new UsageLedger(file);
    const firstWarnings = await ledger.record({ api: "test", operation: "search", tier: "T1", units: 8000 });
    const secondWarnings = await ledger.record({ api: "test", operation: "search", tier: "T1", units: 1500 });
    assert.equal(firstWarnings.length, 1);
    assert.match(firstWarnings[0], /80%/);
    assert.equal(secondWarnings.length, 1);
    assert.match(secondWarnings[0], /95%/);
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.totalUnits, 9500);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
