# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VaultKit is an Elixir/OTP MCP (Model Context Protocol) server that exposes tools for querying and navigating an Obsidian vault. It parses Obsidian-flavored markdown (wikilinks, frontmatter, inline tags, embeds) and maintains an in-memory link graph for fast traversal.

## Build & Development Commands

```bash
mix deps.get              # Install dependencies
mix compile               # Compile
mix test                  # Run all tests
mix test test/vault_kit/graph_test.exs           # Run a single test file
mix test test/vault_kit/graph_test.exs:15        # Run a single test by line
mix format                # Auto-format code
mix credo --strict        # Lint
mix dialyzer              # Static type checking
mix quality               # All checks: format --check-formatted + credo --strict + dialyzer
```

The vault path is configured via the `VAULT_PATH` environment variable (defaults to `~/Dropbox/notes`).

## Architecture

**Data flow:** MCP client -> `MCPServer` -> Tool module -> `Graph` or `Vault` -> response (JSON via Jason)

### Core Modules

- **`VaultKit.Vault`** — File I/O layer. Scans vault for `.md` files (excluding `.obsidian`, `smart-chats`, `templates`, `.claude`, `Excalidraw`, `.trash`, `TagsRoutes/reports/`), reads notes into `Note` structs, and provides full-text search.
- **`VaultKit.Note`** — Struct: `path`, `name`, `content`, `frontmatter`, `wikilinks`, `tags`, `headings`, `checkboxes`.
- **`VaultKit.Markdown`** — Pure parsing functions for wikilinks (`[[Note]]`, `[[Note#Heading]]`, `[[Note|Alias]]`, `![[Embed]]`), YAML frontmatter, headings, checkboxes, and inline tags.
- **`VaultKit.Graph`** — GenServer holding an in-memory link graph built on startup. Stores forward/backward adjacency maps and a set of missing (broken) links. Provides BFS traversal, backlink lookup, orphan detection, and fuzzy name resolution (case-insensitive, ignores `-_`).
- **`VaultKit.MCPServer`** — Hermes MCP server exposing 8 tools over stdio transport.

### MCP Tools (in `lib/vault_kit/mcp_server/tools/`)

Each tool is a `Hermes.Server.Component` with `:tool` type, defining a schema and an `execute/2` callback. Tools delegate to `Graph` or `Vault` and return JSON-encoded responses.

### Test Configuration

Tests disable the MCP server and Graph GenServer (`config/test.exs` sets `start_mcp: false, start_graph: false`). Graph tests start their own supervised GenServer instance pointed at `test/fixtures/`.

## Key Dependencies

- **hermes_mcp** (~0.14) — MCP protocol server framework
- **yaml_elixir** (~2.11) — YAML frontmatter parsing
- **jason** (~1.4) — JSON encoding
- **credo** / **dialyxir** — dev/test only (lint + type checking)
