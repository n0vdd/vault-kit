import { z } from "zod";
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
  rebuildGraph,
  batchResolve,
  type GraphState,
} from "../graph.js";
import { allTags } from "../types.js";
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
        return jsonResult({ error: `Note '${note_name}' not found` });
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
    "rebuild_graph",
    {
      description:
        "Rebuild the in-memory vault graph by re-scanning all notes from disk. Use after files have been added, renamed, or deleted outside of the tools.",
    },
    () => {
      const before = state.notes.size;
      rebuildGraph(state);
      const s = stats(state);
      return jsonResult({
        status: "rebuilt",
        notes_before: before,
        notes_after: s.total_notes,
        missing_links: s.missing_links,
      });
    },
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
}
