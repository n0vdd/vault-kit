# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VaultKit is a TypeScript MCP (Model Context Protocol) server that exposes tools for querying and navigating an Obsidian vault. It parses Obsidian-flavored markdown (wikilinks, frontmatter, inline tags, embeds) and maintains an in-memory link graph for fast traversal.

## Build & Development Commands

```bash
bun install               # Install dependencies
bun run build             # Compile TypeScript
bun test                  # Run all tests (vitest)
bun run test:watch        # Run tests in watch mode
bun start                 # Start the MCP server (requires build first)
bun run lint              # Run ESLint
bun run lint:fix          # Run ESLint with auto-fix
bun run format            # Format code with Prettier
bun run format:check      # Check formatting
bun run check:unused      # Find unused exports/deps with Knip
bun run build:bin         # Compile standalone binary (no runtime needed)
```

The vault path is configured via the `VAULT_PATH` environment variable (defaults to `~/Dropbox/notes`).

## Architecture

**Data flow:** MCP client -> `index.ts` (McpServer) -> Tool module -> `graph.ts` or `vault.ts` -> JSON response over stdio

### Core Modules (`src/`)

- **`types.ts`** — Interfaces: `Note`, `Wikilink`, `Heading`, `Checkbox`.
- **`markdown.ts`** — Pure parsing functions for wikilinks (`[[Note]]`, `[[Note#Heading]]`, `[[Note|Alias]]`, `![[Embed]]`), YAML frontmatter, headings, checkboxes, and inline tags. Uses 4 core regexes.
- **`vault.ts`** — File I/O layer. `scanVault()` finds `.md` files (excluding `.obsidian`, `smart-chats`, `templates`, `.claude`, `Excalidraw`, `.trash`, `TagsRoutes/reports/`). Handles symlink safety (circular symlink detection via `realpathSync`). `readNote()` reads notes into `Note` objects.
- **`graph.ts`** — In-memory link graph built on startup using `Map`/`Set`. Stores forward/backward adjacency maps and missing (broken) links. Provides BFS traversal, backlink lookup, orphan detection, fuzzy name resolution (case-insensitive, ignores `-_`, strips diacritics via NFD normalization), batch operations (resolve/backlinks for up to 50 notes), and `missingNotesBySource` for grouping broken links by source note.
- **`search.ts`** — Content search (substring, whole-word, regex, multi-term OR), tag lookup (`findByTag`), untagged note detection (`findUntagged`), and Levenshtein-based similar name matching (`findSimilarNames`).
- **`filter.ts`** — Shared filtering logic used by graph and search modules. Compiles filter options (folder, exclude folders, exclude pattern, date range, tags with `any`/`all` mode, exclude tags) into predicates. Also provides pagination (`paginate()`).
- **`index.ts`** — Entry point: reads `VAULT_PATH`, builds graph, registers tools, connects stdio transport.

### MCP Tools (`src/tools/`)

All tools are registered in `src/tools/index.ts` via a single `registerAllTools()` function with Zod input schemas. 13 tools: `traverse_links`, `find_backlinks`, `find_orphans`, `find_broken_links`, `resolve_wikilink`, `vault_search`, `find_by_tag`, `vault_stats`, `rebuild_graph`, `batch_resolve`, `batch_find_backlinks`, `find_untagged`, `find_similar_names`.

### Tests (`test/`)

Tests use vitest and run against fixtures in `test/fixtures/`. No server startup needed — tests import functions directly.

## Key Dependencies

- **@modelcontextprotocol/sdk** (^1.26) — MCP protocol server framework
- **zod** (^3.x) — Schema validation for tool inputs
- **yaml** (^2.x) — YAML frontmatter parsing
- **vitest** (^2.x) — Test runner (dev only)
- **typescript** (^5.x) + **@types/node** + **@types/bun** — TypeScript compiler and type definitions (dev only)
- **eslint** (^10.x) + **@eslint/js** + **typescript-eslint** + **eslint-plugin-sonarjs** + **eslint-config-prettier** — Linting with cognitive complexity checks (dev only)
- **prettier** (^3.x) — Code formatting (dev only)
- **knip** (^5.x) — Unused export/dependency detection (dev only)
