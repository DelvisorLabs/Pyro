# Validation for the dashboard, profiles, outgoing webhooks and SDKs

Webhook form follow-up (2026-09-23):

- Replaced comma-separated resource IDs with named, searchable application/profile checklists built from shadcn/ui Radix primitives. Added field help, explicit All scopes, inline risk/action validation and loading/retry feedback.
- Dashboard tests: 12 passed. New coverage checks ID serialization, explicit wildcard selection, preservation of unavailable saved references and disabled webhook state, unchanged destination handling when editing, and risk/action validation. Dashboard production build and whitespace checks passed.
- Verified live application/profile choices, search with and without matches, multiple selection, keyboard toggling, Escape dismissal, focus return and minimum-risk help on localhost. Clearing the final specific selection disables Save. Verified the migrated shared checkbox on Applications without saving changes.
- Checked both themes and a 390px viewport. Corrected nested dialog scrolling so only the form body scrolls; header/footer and checklist contents stay within the viewport. Restored light mode and desktop size, and cancelled test drafts without creating a webhook.
- Restarted Vite on `127.0.0.1:3000` to clear stale imports after adding dependencies. No new runtime errors were observed after restart.

Webhook presentation follow-up (2026-09-23):

- Renamed product copy and navigation references to Webhooks across the dashboard, website and guides; retained technical descriptions of outgoing delivery.
- Removed the local receiver help panel. Delivery history now uses the card width, separates timestamps, labels HTTP responses, shows status badges and only includes an Action column when a delivery can be retried.
- Dashboard and website production builds passed, along with `git diff --check`. Verified Refresh, Add webhook, light/dark presentation and a 390px viewport against existing local delivery history. The table scrolls inside its card without page overflow; no browser errors or warnings were observed.
- Restored light mode and the desktop viewport. Restarted the standalone website on `127.0.0.1:3100` and verified its updated home and documentation copy. All services remain local.

Settings, navigation and library follow-up (2026-09-23):

- Dashboard tests: 8 passed, covering preference migration/validation, library filtering and response defaults, stable detector identity, and historical API response handling. Production dashboard build and whitespace checks passed.
- Verified all six dashboard preference controls, persistence after reload, reset to defaults, System theme selection, compact table cell padding, full Activity timestamps and the neutral-black dark palette (`#050505` canvas). The existing classifier settings remain available separately.
- Verified the restored dropdown opening animation and 180ms sliding highlight, arrow-key selection and focus return inside a profile dialog. Reduced motion suppresses transitions.
- Verified profile library text search, local-only filtering, empty results, YAML inspection and customization into an editable draft. Cancelled the draft without modifying saved policies.
- Verified Playground is under Observe, there is no Test group, Settings has a separate sidebar entry and sidebar hover fills are removed.
- Settings and the library fit a 390px viewport without page overflow. Restored the desktop viewport and default personal preferences after testing. Everything remains on localhost.

Dashboard redesign verification (2026-09-23):

- Dashboard unit tests: 4 passed, including detector editor identity and payload serialization. The editor-only row key stays stable while its API ID changes and is omitted from saves.
- Production dashboard build and `git diff --check`: passed.
- Verified continuous character-by-character typing in both a new detector and an existing detector on `localhost:3000`; full values appeared and focus stayed in the ID input. Cancelled both drafts without modifying saved policies.
- Verified shared dropdown keyboard selection and focus restoration inside the profile dialog. Confirmed Activity filters and request trace dialogs still work.
- Verified neutral light and dark themes, self-hosted Open Sans, themed charts/dialogs, and dark preference persistence after reload. Returned the dashboard to light mode.
- Navigated all nine dashboard pages successfully. A fresh final reload produced no browser console errors or warnings.
- At a 390px viewport, checked collapsible navigation, profile dialogs, Overview, Usage, Applications, Activity and outgoing webhooks. Corrected Applications overflow; those pages fit the viewport, with tables scrolling within their containers. Restored the desktop viewport afterward.

The shared UI conventions and repeatable browser checks are documented in `apps/dashboard/README.md`.

Latest local verification (2026-09-23):

- Reproduced the Protection Profiles white screen on the actual `localhost:3000` dashboard: older backend records omitted `localRules`. Schema defaults now normalize those records before rendering/editing. A page error boundary keeps navigation available if any page fails.
- Verified Activity against the existing database: the list, filters and an existing request trace render. Historical traces without detector arrays and responses without label catalogs have regression coverage; failed requests are shown in the page.
- Verified existing profile cards, the existing profile editor, all four curated presets, outgoing webhook configuration and delivered history in the browser after updating the running services.
- `npm run typecheck`: passed.
- `npm test` with `TEST_DATABASE_URL` pointing to an isolated PostgreSQL 17 instance: 42 tests passed, none skipped. This includes three dashboard compatibility regressions and a worker test ensuring unsupported persisted destinations cannot enqueue or send.
- `docker compose build gateway control-plane`: passed, including all package/application production builds. Both containers were recreated from the new images and report healthy. The existing Vite dashboard remains on port 3000; PostgreSQL data was retained.
- `npm run test:webhook` against the actual local Docker gateway/control plane: passed. Verified HMAC on `integration.test` and a real local-rule `decision.created` event; a deliberate HTTP 503 caused a retry and HTTP 204 completed delivery. Temporary destination/profile removed; audit records retained. All traffic stayed local, with no model request.
- The standalone website passed its Next.js production build and was restarted on `127.0.0.1:3100` with outgoing-webhook-only copy.
- `git diff --check`: passed.

Earlier verification for the unchanged SDK/profile work:

- PostgreSQL checks cover atomic event/outbox writes, duplicate suppression, concurrent claims, expired leases, stale-worker acknowledgements, manual retry and rollback on an invalid delivery.
- Rust SDK: four tests and Clippy with warnings denied passed. Existing Python SDK test passed.
- TypeScript SDK/contracts packed and installed in a separate temporary consumer; imports and a request succeeded.
- Website desktop/mobile layouts, interactive examples, documentation navigation and YAML downloads checked.

The optional observability overlay and non-webhook adapter have been removed. Neither SDK has been published. The website remains a separate localhost-only project in the sibling `pyro-website` directory.
