# VaultKit

TypeScript MCP server for Obsidian vaults. Parses Obsidian-flavored markdown (wikilinks, embeds, frontmatter, inline #tags), builds an in-memory link graph, and exposes 13 tools over stdio.

## Features

- **In-memory link graph** — BFS traversal, backlinks, orphan detection, broken link analysis
- **Fuzzy name resolution** — case-insensitive, diacritics-stripping, dash/underscore normalization
- **Full Obsidian flavor** — wikilinks, embeds, YAML frontmatter, inline #tags, headings, checkboxes
- **Rich filtering** — folder, tags, date range, regex exclude pattern, pagination on every list tool
- **Batch operations** — resolve or find backlinks for up to 50 notes in a single call
- **Near-duplicate detection** — Levenshtein distance matching for similar note names
- **Instant rebuild** — re-scan the vault on demand without restarting the server

## Tools

### Graph traversal

| Tool                | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| `traverse_links`    | BFS from one or more starting notes within N hops           |
| `find_backlinks`    | Find all notes that link to a given note                    |
| `find_orphans`      | Find notes with no incoming links                           |
| `find_broken_links` | Find wikilinks or embeds that reference missing notes/files |

### Note lookup

| Tool                 | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `resolve_wikilink`   | Look up a note by name (fuzzy-matched) with full content |
| `batch_resolve`      | Resolve multiple notes by name in a single call          |
| `find_similar_names` | Find notes with similar names using Levenshtein distance |

### Search & tags

| Tool            | Description                                           |
| --------------- | ----------------------------------------------------- |
| `vault_search`  | Search note content (substring, whole-word, or regex) |
| `find_by_tag`   | Find notes with a specific tag (frontmatter + inline) |
| `find_untagged` | Find notes that have no tags at all                   |

### Vault management

| Tool                   | Description                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| `batch_find_backlinks` | Find backlinks for multiple notes in a single call                |
| `vault_stats`          | Return vault-wide statistics (notes, tags, orphans, broken links) |
| `rebuild_graph`        | Re-scan all notes from disk and rebuild the graph                 |

## Quick start

```bash
git clone https://github.com/n0vdd/vault-kit.git
cd vault-kit
bun install
bun run build
```

### Compiled binary

Build a standalone binary (no runtime needed):

```bash
bun run build:bin
```

This produces a `vault-kit` executable you can place anywhere on your `PATH`.

## Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vault-kit": {
      "command": "bun",
      "args": ["/path/to/vault-kit/dist/index.js"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

Or with the compiled binary:

```json
{
  "mcpServers": {
    "vault-kit": {
      "command": "/path/to/vault-kit",
      "env": {
        "VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

### Claude Code

Add a `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "vault-kit": {
      "command": "bun",
      "args": ["dist/index.js"],
      "cwd": "/path/to/vault-kit",
      "env": {
        "VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

> `VAULT_PATH` defaults to `~/Dropbox/notes` if not set.

## Architecture

```
MCP client → index.ts (McpServer) → tools/index.ts → graph.ts / search.ts / vault.ts → JSON over stdio
```

| Module           | Role                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `index.ts`       | Entry point: reads `VAULT_PATH`, builds graph, registers tools, connects stdio transport                  |
| `tools/index.ts` | All 13 MCP tool registrations with Zod input schemas                                                      |
| `graph.ts`       | In-memory link graph (`Map`/`Set`), BFS traversal, backlinks, orphans, fuzzy resolution, batch operations |
| `search.ts`      | Content search (substring/regex/whole-word), tag lookup, untagged detection, Levenshtein similarity       |
| `filter.ts`      | Shared filtering (folder, tags, dates, exclude patterns) and pagination logic                             |
| `vault.ts`       | File I/O: vault scanning, symlink safety, note reading                                                    |
| `markdown.ts`    | Pure parsing: wikilinks, embeds, frontmatter, headings, checkboxes, inline tags                           |
| `types.ts`       | Core interfaces: `Note`, `Wikilink`, `Heading`, `Checkbox`                                                |

## Development

| Command                | Description                        |
| ---------------------- | ---------------------------------- |
| `bun run build`        | Compile TypeScript                 |
| `bun test`             | Run all tests (vitest)             |
| `bun run test:watch`   | Run tests in watch mode            |
| `bun run lint`         | Run ESLint                         |
| `bun run lint:fix`     | Run ESLint with auto-fix           |
| `bun run format`       | Format code with Prettier          |
| `bun run format:check` | Check formatting                   |
| `bun run build:bin`    | Compile standalone binary          |
| `bun run check:unused` | Find unused exports/deps with Knip |

## License

[AGPL-3.0](LICENSE)
