import { allTags, type Note } from "./types.js";
import type { GraphState } from "./graph.js";
import {
  type FilterOptions,
  type PaginationOpts,
  type PaginatedResult,
  paginate,
  filterNotes,
  isNoteInFolder,
} from "./filter.js";

type SearchHit = { file: string; path: string; line: number; text: string };

function buildMatcher(
  query: string,
  wholeWord: boolean,
  regex: boolean,
  multiTerm: boolean = true,
): (text: string) => boolean {
  if (regex) {
    try {
      const re = new RegExp(query, "i");
      return (text: string) => re.test(text);
    } catch {
      return () => false;
    }
  }
  const q = query.toLowerCase();
  if (wholeWord) {
    const pattern = new RegExp(`\\b${escapeRegex(q)}\\b`, "i");
    return (text: string) => pattern.test(text);
  }
  if (multiTerm) {
    const terms = q.split(/\s+/).filter((t) => t.length > 0);
    if (terms.length > 1) {
      return (text: string) => {
        const lower = text.toLowerCase();
        return terms.some((term) => lower.includes(term));
      };
    }
  }
  return (text: string) => text.toLowerCase().includes(q);
}

function collectNameMatches(
  notes: Map<string, Note>,
  vaultPath: string,
  matchText: (text: string) => boolean,
  hits: SearchHit[],
  folder?: string,
): void {
  for (const [, note] of notes) {
    if (folder && !isNoteInFolder(note, vaultPath, folder)) continue;
    if (matchText(note.name)) {
      hits.push({
        file: note.name,
        path: note.path,
        line: 0,
        text: `[name match] ${note.name}`,
      });
    }
  }
}

function collectContentMatches(
  notes: Map<string, Note>,
  vaultPath: string,
  matchText: (text: string) => boolean,
  hits: SearchHit[],
  folder?: string,
): void {
  for (const [, note] of notes) {
    if (folder && !isNoteInFolder(note, vaultPath, folder)) continue;
    const lines = note.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matchText(lines[i])) {
        hits.push({
          file: note.name,
          path: note.path,
          line: i + 1,
          text: lines[i].trim(),
        });
      }
    }
  }
}

export function search(
  query: string,
  state: GraphState,
  opts: PaginationOpts &
    FilterOptions & {
      wholeWord?: boolean;
      includeNames?: boolean;
      regex?: boolean;
      multiTerm?: boolean;
    } = {},
) {
  const matchText = buildMatcher(
    query,
    opts.wholeWord ?? false,
    opts.regex ?? false,
    opts.multiTerm ?? true,
  );

  const filteredNotes = filterNotes(state.notes, state.vaultPath, {
    excludeFolders: opts.excludeFolders,
    excludePattern: opts.excludePattern,
    modifiedAfter: opts.modifiedAfter,
    modifiedBefore: opts.modifiedBefore,
    tags: opts.tags,
    excludeTags: opts.excludeTags,
  });

  const collected: SearchHit[] = [];
  if (opts.includeNames) {
    collectNameMatches(
      filteredNotes,
      state.vaultPath,
      matchText,
      collected,
      opts.folder,
    );
  }
  collectContentMatches(
    filteredNotes,
    state.vaultPath,
    matchText,
    collected,
    opts.folder,
  );

  return paginate(collected, opts);
}

export function findByTag(
  tag: string,
  state: GraphState,
  opts: PaginationOpts & FilterOptions = {},
): PaginatedResult<{
  name: string;
  path: string;
  tags: string[];
  frontmatterTags: string[];
  inlineTags: string[];
}> {
  const normalizedTag = tag.replace(/^#/, "").toLowerCase();
  const inScope = filterNotes(state.notes, state.vaultPath, opts);

  const matches: {
    name: string;
    path: string;
    tags: string[];
    frontmatterTags: string[];
    inlineTags: string[];
  }[] = [];
  for (const [, note] of inScope) {
    if (allTags(note).some((t) => t.toLowerCase() === normalizedTag)) {
      matches.push({
        name: note.name,
        path: note.path,
        tags: allTags(note),
        frontmatterTags: note.frontmatterTags,
        inlineTags: note.inlineTags,
      });
    }
  }
  matches.sort((a, b) => a.name.localeCompare(b.name));

  return paginate(matches, opts);
}

export function findUntagged(
  state: GraphState,
  opts: PaginationOpts & FilterOptions = {},
): PaginatedResult<{ name: string; path: string }> {
  const inScope = filterNotes(state.notes, state.vaultPath, opts);

  const matches: { name: string; path: string }[] = [];
  for (const [, note] of inScope) {
    if (note.frontmatterTags.length === 0 && note.inlineTags.length === 0) {
      matches.push({ name: note.name, path: note.path });
    }
  }
  matches.sort((a, b) => a.name.localeCompare(b.name));

  return paginate(matches, opts);
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

export function findSimilarNames(
  name: string,
  state: GraphState,
  opts: PaginationOpts & { threshold?: number } = {},
): PaginatedResult<{ name: string; path: string; distance: number }> {
  const threshold = opts.threshold ?? 3;
  const lowerName = name.toLowerCase();

  const matches: { name: string; path: string; distance: number }[] = [];
  for (const [, note] of state.notes) {
    const dist = levenshtein(lowerName, note.name.toLowerCase());
    if (dist > 0 && dist <= threshold) {
      matches.push({ name: note.name, path: note.path, distance: dist });
    }
  }
  matches.sort(
    (a, b) => a.distance - b.distance || a.name.localeCompare(b.name),
  );

  return paginate(matches, opts);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
