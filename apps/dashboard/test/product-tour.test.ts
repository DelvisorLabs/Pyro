import assert from "node:assert/strict";
import test from "node:test";
import { tourSteps } from "../src/lib/product-tour";

test("tour stays within seven steps and never sends restricted users into admin pages", () => {
  const restricted = new Set(["apps", "history", "playground"]);
  for (const role of ["admin", "operator", "reviewer", "viewer"] as const) {
    const steps = tourSteps(role);
    assert.ok(steps.length > 0 && steps.length <= 7);
    assert.equal(new Set(steps.map((step) => step.page)).size, steps.length);
    if (role !== "admin") assert.ok(steps.every((step) => !restricted.has(step.page)));
    if (role === "reviewer" || role === "viewer") assert.ok(steps.every((step) => step.page !== "keys"));
  }
  assert.equal(tourSteps("admin").length, 7);
  assert.match(tourSteps("viewer").find((step) => step.page === "reviews")!.description, /Inspect/);
});
