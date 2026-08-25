# Capability Registry

`src/tools/registry.js` owns the canonical definitions and live detection state for every Meera tool.

Each definition includes:

- stable `id`, human `name`, `category`, and description
- permission level
- required and optional typed parameters
- capability detection
- real execution implementation

Consumers use `getAvailableTools()` for executable tools, `getRegistryHealth()` for counts, `getRegistrySnapshot()` for diagnostics, and `formatRegistryDump()` for `/tools`. The extended registry currently includes system/battery/environment, file search/metadata, network ping, Spotify search, optional PDF text extraction, optional PyAutoGUI/pywinauto/Playwright, Gmail, Notion, and local Obsidian vault tools alongside the original tools. No router, UI, or self-awareness layer maintains a second tool list.

Optional integrations are enabled only when their backend is available:

- Gmail: `GMAIL_ACCESS_TOKEN`
- Notion: `NOTION_TOKEN` and optional `NOTION_VERSION`
- Obsidian: `OBSIDIAN_VAULT_PATH`

Detection failures are explicit: a registered but unavailable tool remains visible as unavailable in diagnostics and cannot be executed.
