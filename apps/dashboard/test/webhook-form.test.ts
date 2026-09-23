import assert from "node:assert/strict";
import test from "node:test";
import { IntegrationSchema } from "@pyro/contracts";
import { scopeChoices } from "../src/lib/resource-scope.js";
import { createWebhookDraft, webhookDraftError, webhookPayload } from "../src/lib/webhook-form.js";

test("checklist selections serialize to stable IDs, independently for apps and profiles", () => {
  const draft = createWebhookDraft();
  draft.name = "Production alerts";
  draft.url = "https://example.com/events";
  draft.applications = { all: false, ids: ["app-1", "app-2"] };
  draft.profiles = { all: false, ids: ["profile-2"] };
  draft.minimumRisk = "0.8";
  const payload = webhookPayload(draft);
  assert.deepEqual(payload.appIds, ["app-1", "app-2"]);
  assert.deepEqual(payload.profileIds, ["profile-2"]);
  assert.equal(payload.minimumRisk, 0.8);
  assert.equal("applications" in payload, false);
  assert.equal("profiles" in payload, false);
});

test("clearing the last selected item cannot silently expand delivery to all resources", () => {
  const draft = { ...createWebhookDraft(), name: "Alerts", url: "https://example.com/events" };
  for (const field of ["applications", "profiles"] as const) {
    draft[field] = { all: false, ids: [] };
    assert.throws(() => webhookPayload(draft), /Select at least one/);
    draft[field] = { all: true, ids: [] };
  }
  assert.deepEqual(webhookPayload(draft).appIds, []);
  assert.deepEqual(webhookPayload(draft).profileIds, []);
});

test("editing preserves disabled state, unknown saved scopes and the existing destination", () => {
  const webhook = IntegrationSchema.parse({
    id: "41dd78d3-8c14-4d8d-b4f5-b12f29d3139e", name: "Existing", enabled: false,
    appIds: ["deleted-app"], profileIds: ["existing-profile"], minimumRisk: 0.65,
    createdAt: "2026-09-23T12:00:00Z", updatedAt: "2026-09-23T12:00:00Z",
  });
  const draft = createWebhookDraft(webhook);
  const choices = scopeChoices([{ id: "another-app", name: "Another app" }], draft.applications, "application");
  assert.deepEqual(choices[1], { id: "deleted-app", name: "Unavailable application", unavailable: true });
  const payload = webhookPayload(draft);
  assert.deepEqual(payload.appIds, webhook.appIds);
  assert.deepEqual(payload.profileIds, webhook.profileIds);
  assert.equal(payload.enabled, false);
  assert.equal(payload.url, ""); // Existing API preserves the encrypted destination on an empty URL.
  draft.applications.ids.push("another-app");
  assert.deepEqual(webhook.appIds, ["deleted-app"]);
});

test("required fields, action choices and risk bounds are validated before saving", () => {
  const draft = createWebhookDraft();
  assert.match(webhookDraftError(draft)!, /name/);
  draft.name = "Alerts";
  assert.match(webhookDraftError(draft)!, /destination/);
  draft.url = "https://example.com/events";
  for (const risk of ["", "-0.1", "1.1", "NaN"]) {
    draft.minimumRisk = risk;
    assert.throws(() => webhookPayload(draft), /0 to 1/);
  }
  for (const risk of ["0", "0.725", "1"]) {
    draft.minimumRisk = risk;
    assert.equal(webhookDraftError(draft), undefined);
  }
  draft.actions = [];
  assert.throws(() => webhookPayload(draft), /action/);
});
