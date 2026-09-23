# Dashboard UI

Run from the repository root with `npm run dev -w @pyro/dashboard`. The local dashboard uses port 3000.

## Shared components and styling

- `src/index.css` owns the light/dark semantic colour tokens, self-hosted Open Sans, typography and responsive layout. Light is the default. Avoid page-specific colour values.
- `src/components/ui` contains the shared buttons, inputs, textareas, checkboxes, switches, dropdowns, dialogs, field labels/errors, tables, cards and metric cards. Controls use 4px corners; cards and dialogs use 6px.
- `PageHeader` in `components/shared.tsx` provides page titles and descriptions. Titles are 22px, section headings 14–16px, controls/body text 13–14px and supporting text 12px. Use monospace only for code, YAML, regex and raw identifiers.
- Existing React Bits navigation, dials and call chips use the same tokens. Both dropdown APIs share React Bits glide motion: a sliding highlight, rotating chevron and opening/closing transitions. Radix provides portalled menus, focus restoration, scrolling and keyboard selection. The original motion styles live in `components/react-bits/GlideSelect.css`.
- `SideSelector` in `components/ui/side-selector.tsx` provides the shared master/detail list used by Profile library and Applications. Pass controlled `value`/`onValueChange`, items with stable values, labels and optional icons/metadata/descriptions, plus optional caption/footer text. Selection styling, focus treatment, row spacing and scrolling are owned by the component.
- `ResourceScopePicker` composes shadcn/ui Radix Popover and Checkbox primitives into a searchable checklist. Pass named choices and an explicit `{ all, ids }` scope. An empty specific selection is invalid, not a wildcard. Unavailable saved IDs remain visible until removed. `HelpTooltip` uses the shared shadcn/ui Radix Tooltip with hover, focus, click and Escape support.
- Use `chartTooltipStyle` and the `--chart-*` variables for charts so both themes stay readable.
- `ThemeProvider` stores validated browser preferences under `pyro-dashboard-preferences` and migrates the previous `pyro-theme` value. The initial HTML applies appearance before rendering to avoid a theme flash. Settings is a separate sidebar entry; Playground belongs to Observe.

## Settings and profile library

Settings → Dashboard controls light/dark/system theme, table density, reduced motion, live refreshes, in-app decision notifications and Activity timestamps. Changes apply immediately and persist in this browser. System theme follows OS changes; reduced motion always respects the OS preference. Live updates gate both decision-driven refreshes and the Overview/delivery polling timers. Provider configuration remains separately saved under Settings → Classifier provider. Personal preferences never change policy enforcement or webhook delivery.

Protection profiles has two views: Your profiles and Profile library. The library reads the existing YAML catalogue from `/api/profile-presets`, supports search and model/local-only filtering, and previews actual policy details or the original YAML. Downloads retain that YAML. Customize profile opens a detached editable copy with a unique name/ID; the normal validated create flow saves it. It does not alter the preset or attach the new policy to an application.

## Detector editing

The editor adds a separate `editorKey` to each detector, independent of its editable API ID. Use that key for the React row identity. Generate it only when opening a profile or adding a detector, and use `profilePayload` when saving so editor metadata never reaches the API or exported profiles.

## Checks

From the repository root:

```sh
npm run test -w @pyro/dashboard
npm run build -w @pyro/dashboard
```

Browser regression checks on localhost:

1. Open an existing profile and expand a detector. Clear its ID and type a full identifier without clicking the field again. Verify every character appears and focus remains. Cancel the draft, then repeat with a new profile and detector.
2. In the profile dialog, open Fail mode and select an option with the arrow keys and Enter. Verify focus returns to the trigger. Cancel to preserve the saved policy.
3. In Settings, change theme, density, motion, live updates, notifications and timestamps; reload and verify persistence. Check compact Activity rows and absolute dates, then reset preferences. Check System theme and the provider settings section.
4. At a 390px viewport, verify the navigation expands and closes after selection, cards fit, and profile dialogs do not scroll horizontally.

5. In Profile library, search by a rule or detector, filter local-only profiles, inspect policy details and YAML, then customize a copy. Cancel and verify the library and saved profiles are unchanged. Check a search with no matches.
6. Open a dropdown with the keyboard; verify the highlight glides between options and focus returns after selecting. Enable reduced motion and verify those transitions are suppressed.
7. In Add webhook, search and select applications/profiles by name. Verify selections survive filtering and reopening, Space toggles a checkbox, and Escape closes only the picker or tooltip. Clearing the last specific selection must disable Save until an item or All is selected. Check mobile scrolling keeps the dialog header/footer visible, and cancel the draft without creating a destination.
