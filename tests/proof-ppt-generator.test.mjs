import test from "node:test";
import assert from "node:assert/strict";

import { proofSlidePlacements } from "../src/travel-proof/proof-ppt-generator.js";

test("proofSlidePlacements keeps route, oil, and one extra proof in readable columns", () => {
  const placements = proofSlidePlacements({
    route: [{ name: "route.png" }],
    oil: [{ name: "oil.png" }],
    extra: [{ name: "receipt.png" }]
  });

  assert.equal(placements.length, 3);
  assert.equal(placements[0].image.name, "route.png");
  assert.equal(placements[1].image.name, "oil.png");
  assert.equal(placements[2].image.name, "receipt.png");
  assert.ok(placements[0].box.w < 4.2);
  assert.ok(placements[1].box.w < 3.2);
  assert.ok(placements[2].box.w < 3.8);
  assert.ok(placements[0].box.h < 5.4);
});

test("proofSlidePlacements uses a compact grid for multiple extra proofs", () => {
  const placements = proofSlidePlacements({
    route: [{ name: "route.png" }],
    oil: [{ name: "oil.png" }],
    extra: [
      { name: "receipt-1.png" },
      { name: "receipt-2.png" },
      { name: "receipt-3.png" },
      { name: "receipt-4.png" }
    ]
  });
  const extraPlacements = placements.slice(2);

  assert.equal(placements.length, 6);
  assert.ok(extraPlacements.every((placement) => placement.box.w < 2.0));
  assert.ok(extraPlacements.some((placement) => placement.box.y > extraPlacements[0].box.y));
});
