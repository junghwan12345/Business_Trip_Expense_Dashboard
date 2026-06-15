import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_JSON_BODY_LIMIT,
  PPT_JSON_BODY_LIMIT,
  jsonBodyLimitForPath
} from "../src/server-limits.js";

test("ppt-build allows larger JSON bodies for selected-folder image uploads", () => {
  assert.equal(jsonBodyLimitForPath("/api/travel-proof/ppt-build"), PPT_JSON_BODY_LIMIT);
  assert.ok(PPT_JSON_BODY_LIMIT > DEFAULT_JSON_BODY_LIMIT);
});

test("other API routes keep the default JSON body limit", () => {
  assert.equal(jsonBodyLimitForPath("/api/travel-proof/preview"), DEFAULT_JSON_BODY_LIMIT);
  assert.equal(jsonBodyLimitForPath("/api/travel-proof/capture"), DEFAULT_JSON_BODY_LIMIT);
});
