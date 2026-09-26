# Working agreements

- Make local commits for completed changes. Do not push, create PRs, merge, publish, or deploy unless explicitly requested.
- Use pnpm. Keep the CLI usable without Docker or a server; Docker is optional for shared server/dashboard features.

# UI consistency

- Visual rules apply to every page, dialog, form and state, including new features. Do not treat consistency fixes as isolated page exceptions.
- Reuse the dashboard's shared controls, labels, cards, tables, badges and dialogs from `apps/dashboard/src/components/ui`. `GlideSelect` is a supported wrapper around the shared Select. Do not introduce native selects, checkboxes or bare tables in page components.
- Stack field labels consistently above controls. Align related fields in responsive grids, wrap action groups, and keep wide tables and code within their own scroll containers.
- Long dialogs must have a scrolling body with their header and action footer visible. Preserve keyboard navigation, accessible field names, loading/error/empty states, and the light/dark theme tokens.
- For UI changes, audit sibling pages and shared components for the same issue. Verify relevant desktop/mobile layouts and interaction states before considering the fix complete.
