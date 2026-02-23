import { z } from "zod";
import { writeFileSync, readFileSync } from "fs";
import { scanVault } from "../vault.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  traverse,
  backlinks,
  batchFindBacklinks,
  orphans,
  missingNotes,
  missingNotesBySource,
  resolve,
  stats,
  batchResolve,
  refreshNote,
  type GraphState,
} from "../graph.js";
import { allTags } from "../types.js";
import { extractFrontmatter, replaceFrontmatter } from "../markdown.js";
import {
  search,
  findByTag,
  findUntagged,
  findSimilarNames,
} from "../search.js";
import type { FilterOptions, PaginationOpts } from "../filter.js";

const paginationSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe("Maximum number of results to return (default: 50)"),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe("Number of results to skip (default: 0)"),
};

const dateFilterSchema = {
  modified_after: z
    .string()
    .optional()
    .describe(
      "Only include notes modified after this ISO date (e.g. '2024-01-01')",
    ),
  modified_before: z
    .string()
    .optional()
    .describe(
      "Only include notes modified before this ISO date (e.g. '2024-12-31')",
    ),
};

const excludeFoldersSchema = {
  exclude_folders: z
    .array(z.string())
    .optional()
    .describe(
      "Folders to exclude from results (e.g. ['journal', 'templates'])",
    ),
};

const excludePatternSchema = {
  exclude_pattern: z
    .string()
    .optional()
    .describe(
      "Regex pattern to exclude notes by name (case-insensitive, e.g. '^Daily')",
    ),
};

const tagsFilterSchema = {
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Only include notes with at least one of these tags (OR semantics, e.g. ['smartcom', 'voip'])",
    ),
  exclude_tags: z
    .array(z.string())
    .optional()
    .describe(
      "Exclude notes that have any of these tags (e.g. ['journal', 'excalidraw'])",
    ),
  tags_mode: z
    .enum(["any", "all"])
    .optional()
    .default("any")
    .describe(
      "How to match tags: 'any' (default) matches notes with at least one tag, 'all' requires every tag to be present",
    ),
};

const folderSchema = {
  folder: z
    .string()
    .optional()
    .describe(
      "Only include notes in this folder (e.g. 'journal' or 'projects')",
    ),
};

const commonFilterSchema = {
  ...folderSchema,
  ...excludeFoldersSchema,
  ...excludePatternSchema,
  ...tagsFilterSchema,
  ...dateFilterSchema,
  ...paginationSchema,
};

const commonFilterNoPagination = {
  ...folderSchema,
  ...excludeFoldersSchema,
  ...excludePatternSchema,
  ...tagsFilterSchema,
  ...dateFilterSchema,
};

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

function extractExistingTags(fm: Record<string, unknown>): string[] {
  if (Array.isArray(fm.tags)) return fm.tags.map(String);
  if (typeof fm.tags === "string") return [fm.tags];
  return [];
}

function mergeTags(existing: string[], incoming: string[]): string[] {
  const normalized = incoming.map((t) => t.replace(/^#/, "").toLowerCase());
  return [
    ...new Set([...existing.map((t) => t.toLowerCase()), ...normalized]),
  ].sort((a, b) => a.localeCompare(b));
}

function validateTags(
  incoming: string[],
  canonicalTags: Set<string>,
): string[] {
  if (canonicalTags.size === 0) return [];
  const unknown = incoming
    .map((t) => t.replace(/^#/, "").toLowerCase())
    .filter((t) => !canonicalTags.has(t));
  return unknown;
}

function mergeLinks(
  existing: Record<string, unknown>,
  incoming: string[],
): string[] {
  const existingLinks: string[] = Array.isArray(existing.links)
    ? existing.links.map(String)
    : [];
  return [...new Set([...existingLinks, ...incoming])];
}

function mergeAliases(
  existing: Record<string, unknown>,
  incoming: string[],
): string[] {
  const existingAliases: string[] = Array.isArray(existing.aliases)
    ? existing.aliases.map(String)
    : [];
  // Deduplicate by exact value (case-sensitive — aliases are display names)
  const seen = new Set(existingAliases);
  const merged = [...existingAliases];
  for (const alias of incoming) {
    if (!seen.has(alias)) {
      seen.add(alias);
      merged.push(alias);
    }
  }
  return merged;
}

function findNoteOnDisk(name: string, vaultPath: string): string | null {
  const allPaths = scanVault(vaultPath);
  const normalized = name.trim().toLowerCase();
  for (const p of allPaths) {
    const base = p.slice(p.lastIndexOf("/") + 1, -3).toLowerCase();
    if (base === normalized) return p;
  }
  return null;
}

function mapFilterOpts(
  input: Record<string, unknown>,
): FilterOptions & PaginationOpts {
  return {
    folder: input.folder as string | undefined,
    excludeFolders: input.exclude_folders as string[] | undefined,
    excludePattern: input.exclude_pattern as string | undefined,
    modifiedAfter: input.modified_after as string | undefined,
    modifiedBefore: input.modified_before as string | undefined,
    tags: input.tags as string[] | undefined,
    excludeTags: input.exclude_tags as string[] | undefined,
    tagsMode: input.tags_mode as "any" | "all" | undefined,
    limit: input.limit as number | undefined,
    offset: input.offset as number | undefined,
  };
}

export function registerAllTools(server: McpServer, state: GraphState) {
  server.registerTool(
    "traverse_links",
    {
      description:
        "Find all notes reachable from one or more starting notes within N link hops. Returns each note with its depth, link type, and any broken links encountered.",
      inputSchema: {
        note_name: z
          .union([z.string(), z.array(z.string()).min(1)])
          .describe(
            "Name of the starting note (without .md extension), or an array of names for multi-root traversal",
          ),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .default(2)
          .describe(
            "Maximum hops in the link graph to traverse (1 = direct links only, default: 2)",
          ),
        ...excludeFoldersSchema,
      },
    },
    ({ note_name, depth, exclude_folders }) =>
      jsonResult(
        traverse(note_name, depth, state, {
          excludeFolders: exclude_folders,
        }),
      ),
  );

  server.registerTool(
    "find_backlinks",
    {
      description:
        "Find all notes that link to the given note (incoming links/backlinks). Optionally filter by folder, tags, date, or exclude by name pattern.",
      inputSchema: {
        note_name: z
          .string()
          .describe("Name of the note to find backlinks for"),
        ...commonFilterSchema,
      },
    },
    ({ note_name, ...rest }) =>
      jsonResult(backlinks(note_name, state, mapFilterOpts(rest))),
  );

  server.registerTool(
    "find_orphans",
    {
      description:
        "Find notes with no incoming links from other notes (orphans). Optionally filter by folder, tags, date, or exclude by name pattern.",
      inputSchema: {
        ...commonFilterSchema,
      },
    },
    (input) => jsonResult(orphans(state, mapFilterOpts(input))),
  );

  server.registerTool(
    "find_broken_links",
    {
      description:
        "Find broken links — wikilinks or embeds that reference notes/files that don't exist in the vault. Optionally filter referrers by folder, tags, date, or name pattern.",
      inputSchema: {
        type: z
          .enum(["note", "embed", "all"])
          .optional()
          .default("all")
          .describe(
            "Filter by type: 'note' for broken wikilinks, 'embed' for missing images/attachments, 'all' for both",
          ),
        note_names: z
          .array(z.string())
          .optional()
          .describe(
            "Only show broken links originating from these specific notes (resolved by name)",
          ),
        group_by: z
          .enum(["target", "source"])
          .optional()
          .default("target")
          .describe(
            "Group results by 'target' (default, groups by broken link name) or 'source' (groups by the note containing broken links, sorted by count desc)",
          ),
        ...commonFilterSchema,
      },
    },
    ({ type, note_names, group_by, ...rest }) => {
      const sharedOpts = {
        type,
        noteNames: note_names,
        ...mapFilterOpts(rest),
      };
      if (group_by === "source") {
        return jsonResult(missingNotesBySource(state, sharedOpts));
      }
      return jsonResult(missingNotes(state, sharedOpts));
    },
  );

  server.registerTool(
    "resolve_wikilink",
    {
      description:
        "Look up a note by name (case-insensitive, fuzzy-matches dashes/underscores). Returns the note's full content, frontmatter, and tags.",
      inputSchema: {
        note_name: z
          .string()
          .describe("Wikilink name to resolve (case-insensitive)"),
      },
    },
    ({ note_name }) => {
      const note = resolve(note_name, state);
      if (!note) {
        return errorResult(`Note '${note_name}' not found`);
      }
      return jsonResult({
        name: note.name,
        path: note.path,
        content: note.content,
        frontmatter: note.frontmatter ?? {},
        tags: allTags(note),
        frontmatterTags: note.frontmatterTags,
        inlineTags: note.inlineTags,
        headings: note.headings,
        checkboxes: note.checkboxes,
      });
    },
  );

  server.registerTool(
    "vault_search",
    {
      description:
        "Search note body content for a query string (case-insensitive substring match). Optionally also match against note names. Filter by folder, tags, date, or name pattern.",
      inputSchema: {
        query: z
          .string()
          .max(1000)
          .describe("Search query string (case-insensitive)"),
        whole_word: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Match whole words only using word boundary matching (default: false)",
          ),
        include_names: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Also match against note names/titles (results shown with line: 0)",
          ),
        regex: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Treat query as a regular expression instead of a literal string (default: false)",
          ),
        multi_term: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "When true (default), multi-word queries match ANY term (OR). Set to false for exact substring matching.",
          ),
        ...commonFilterSchema,
      },
    },
    ({ query, whole_word, include_names, regex, multi_term, ...rest }) =>
      jsonResult(
        search(query, state, {
          wholeWord: whole_word,
          includeNames: include_names,
          regex,
          multiTerm: multi_term,
          ...mapFilterOpts(rest),
        }),
      ),
  );

  server.registerTool(
    "find_by_tag",
    {
      description:
        "Find notes with a specific tag. Searches both YAML frontmatter tags and inline #tags. Optionally filter by folder, additional tags, date, or name pattern.",
      inputSchema: {
        tag: z
          .string()
          .describe(
            "Tag to search for (with or without leading #). Searches both frontmatter and inline tags.",
          ),
        ...commonFilterSchema,
      },
    },
    ({ tag, ...rest }) =>
      jsonResult(findByTag(tag, state, mapFilterOpts(rest))),
  );

  server.registerTool(
    "vault_stats",
    {
      description:
        "Return vault-wide statistics: total notes, tagged/untagged counts, orphan count, and broken link count. Optionally scoped by folder, tags, date, or name pattern.",
      inputSchema: {
        ...commonFilterNoPagination,
      },
    },
    (input) => jsonResult(stats(state, mapFilterOpts(input))),
  );

  server.registerTool(
    "batch_resolve",
    {
      description:
        "Resolve multiple notes by name in a single call. Returns full content for each resolved note and errors for any that could not be found.",
      inputSchema: {
        names: z
          .array(z.string())
          .min(1)
          .max(50)
          .describe(
            "Array of note names to resolve (1-50 names, without .md extension)",
          ),
      },
    },
    ({ names }) => jsonResult(batchResolve(names, state)),
  );

  server.registerTool(
    "batch_find_backlinks",
    {
      description:
        "Find backlinks for multiple notes in a single call. Returns backlinks for each resolved note and errors for any that could not be found. Optionally filter by folder, tags, date, or name pattern.",
      inputSchema: {
        names: z
          .array(z.string())
          .min(1)
          .max(50)
          .describe(
            "Array of note names to find backlinks for (1-50 names, without .md extension)",
          ),
        ...commonFilterSchema,
      },
    },
    ({ names, ...rest }) =>
      jsonResult(batchFindBacklinks(names, state, mapFilterOpts(rest))),
  );

  server.registerTool(
    "find_untagged",
    {
      description:
        "Find notes that have no tags (neither frontmatter nor inline). Optionally filter by folder, tags to exclude, date, or name pattern.",
      inputSchema: {
        ...folderSchema,
        ...excludeFoldersSchema,
        ...excludePatternSchema,
        exclude_tags: tagsFilterSchema.exclude_tags,
        ...dateFilterSchema,
        ...paginationSchema,
      },
    },
    (input) => jsonResult(findUntagged(state, mapFilterOpts(input))),
  );

  server.registerTool(
    "find_similar_names",
    {
      description:
        "Find notes with names similar to the given name using Levenshtein distance. Useful for detecting near-duplicates or typos.",
      inputSchema: {
        name: z.string().describe("The note name to compare against"),
        threshold: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .default(3)
          .describe(
            "Maximum edit distance to consider as similar (1-10, default: 3)",
          ),
        ...paginationSchema,
      },
    },
    ({ name, threshold, limit, offset }) =>
      jsonResult(findSimilarNames(name, state, { threshold, limit, offset })),
  );

  server.registerTool(
    "write_frontmatter",
    {
      description:
        "Add tags, links, and/or aliases to a note's YAML frontmatter. Merge-only: never deletes existing values. Validates tags against the canonical vocabulary (tags.md) and warns about unknown ones. Updates the in-memory graph after writing.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
      inputSchema: {
        note_name: z
          .string()
          .describe(
            "Name of the note to update (resolved via fuzzy matching, without .md extension)",
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe("Tags to add (merged with existing, deduplicated, sorted)"),
        links: z
          .array(z.string())
          .optional()
          .describe(
            'Wikilinks to add to the links: field (format: "[[Note Name]]")',
          ),
        aliases: z
          .array(z.string())
          .optional()
          .describe(
            "Aliases to add (merged with existing, deduplicated, order and casing preserved)",
          ),
      },
    },
    ({ note_name, tags, links, aliases }) => {
      if (!tags?.length && !links?.length && !aliases?.length) {
        return errorResult(
          "At least one of 'tags', 'links', or 'aliases' must be provided",
        );
      }

      let note = resolve(note_name, state);
      if (!note) {
        // Fallback: look for the file on disk (handles newly created notes)
        const diskPath = findNoteOnDisk(note_name, state.vaultPath);
        if (diskPath) {
          refreshNote(diskPath, state);
          note = resolve(note_name, state);
        }
        if (!note) {
          return errorResult(`Note '${note_name}' not found`);
        }
      }

      try {
        const content = readFileSync(note.path, "utf-8");
        const fm = extractFrontmatter(content) ?? {};
        const warnings: string[] = [];

        if (tags?.length) {
          fm.tags = mergeTags(extractExistingTags(fm), tags);
          const unknown = validateTags(tags, state.canonicalTags);
          if (unknown.length > 0) {
            warnings.push(`Unknown tags not in tags.md: ${unknown.join(", ")}`);
          }
        }

        if (links?.length) {
          fm.links = mergeLinks(fm, links);
        }

        if (aliases?.length) {
          fm.aliases = mergeAliases(fm, aliases);
        }

        writeFileSync(note.path, replaceFrontmatter(content, fm), "utf-8");
        refreshNote(note.path, state);

        const result: Record<string, unknown> = {
          note: note.name,
          path: note.path,
          frontmatter: fm,
        };
        if (warnings.length > 0) result.warnings = warnings;

        return jsonResult(result);
      } catch (err) {
        return errorResult(
          `Failed to update '${note_name}': ${(err as Error).message}`,
        );
      }
    },
  );
}
