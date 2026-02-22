import { allTags, type Note } from "./types.js";
import { scanVault, readNote } from "./vault.js";
import { stripFrontmatterLines } from "./markdown.js";
import {
  type FilterOptions,
  type PaginationOpts,
  type PaginatedResult,
  type CompiledFilter,
  paginate,
  ensureTrailingSlash,
  compileFilter,
  passesCompiledFilter,
  passesExcludePattern,
  filterNotes,
} from "./filter.js";

export interface GraphState {
  vaultPath: string;
  notes: Map<string, Note>;
  forward: Map<string, Set<string>>;
  backward: Map<string, Set<string>>;
  missing: Map<string, Set<string>>;
  fuzzyIndex: Map<string, string>;
}

export function buildGraph(vaultPath: string): GraphState {
  const paths = scanVault(vaultPath);
  const notes = new Map<string, Note>();

  for (const path of paths) {
    try {
      const note = readNote(path);
      notes.set(normalize(note.name), note);
    } catch {
      // skip unreadable files
    }
  }

  const { forward, backward, missing } = buildAdjacency(notes);

  const fuzzyIndex = new Map<string, string>();
  for (const [key, note] of notes) {
    const fk = normalizeFuzzy(note.name);
    if (!fuzzyIndex.has(fk)) fuzzyIndex.set(fk, key);
  }

  return { vaultPath, notes, forward, backward, missing, fuzzyIndex };
}

export function rebuildGraph(state: GraphState): void {
  const fresh = buildGraph(state.vaultPath);
  state.notes = fresh.notes;
  state.forward = fresh.forward;
  state.backward = fresh.backward;
  state.missing = fresh.missing;
  state.fuzzyIndex = fresh.fuzzyIndex;
}

function buildAdjacency(notes: Map<string, Note>) {
  const forward = new Map<string, Set<string>>();
  const backward = new Map<string, Set<string>>();
  const missing = new Map<string, Set<string>>();

  for (const [sourceKey, note] of notes) {
    const targets = new Set(note.wikilinks.map((wl) => normalize(wl.name)));
    forward.set(sourceKey, targets);

    for (const targetKey of targets) {
      if (!backward.has(targetKey)) backward.set(targetKey, new Set());
      backward.get(targetKey)!.add(sourceKey);

      if (!notes.has(targetKey)) {
        if (!missing.has(targetKey)) missing.set(targetKey, new Set());
        missing.get(targetKey)!.add(sourceKey);
      }
    }
  }

  return { forward, backward, missing };
}

export function resolve(name: string, state: GraphState): Note | null {
  const key = normalize(name);
  const note = state.notes.get(key);
  if (note) return note;
  return fuzzyResolve(name, state);
}

function fuzzyResolve(name: string, state: GraphState): Note | null {
  const fk = normalizeFuzzy(name);
  const key = state.fuzzyIndex.get(fk);
  if (key) return state.notes.get(key) ?? null;
  return null;
}

// --- Tools ---

export function batchResolve(names: string[], state: GraphState) {
  const resolved: {
    name: string;
    path: string;
    content: string;
    frontmatter: Record<string, unknown>;
    tags: string[];
    frontmatterTags: string[];
    inlineTags: string[];
    headings: Note["headings"];
    checkboxes: Note["checkboxes"];
  }[] = [];
  const errors: { name: string; error: string }[] = [];

  for (const name of names) {
    const note = resolve(name, state);
    if (note) {
      resolved.push({
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
    } else {
      errors.push({ name, error: `Note '${name}' not found` });
    }
  }

  return { resolved, errors };
}

function filterBacklinkRef(
  refKey: string,
  state: GraphState,
  folder: string | undefined,
  cf: CompiledFilter,
): { name: string; path: string | null } | null {
  const n = state.notes.get(refKey);
  const name = n ? n.name : refKey;
  const path = n ? n.path : null;

  if (folder) {
    if (!path) return { name, path };
    const relPath = path.slice(state.vaultPath.length + 1);
    if (!relPath.startsWith(ensureTrailingSlash(folder))) return null;
  }

  if (!n) {
    if (!passesExcludePattern(name, cf.excludeRe)) return null;
  } else {
    if (!passesCompiledFilter(n, state.vaultPath, cf)) return null;
  }
  return { name, path };
}

export function backlinks(
  noteName: string,
  state: GraphState,
  opts: PaginationOpts & FilterOptions = {},
): PaginatedResult<{ name: string; path: string | null }> {
  const note = resolve(noteName, state);
  if (!note) return paginate([], opts);
  const key = normalize(note.name);
  const refs = state.backward.get(key);
  if (!refs) return paginate([], opts);

  const cf = compileFilter({
    excludeFolders: opts.excludeFolders,
    excludePattern: opts.excludePattern,
    modifiedAfter: opts.modifiedAfter,
    modifiedBefore: opts.modifiedBefore,
    tags: opts.tags,
    excludeTags: opts.excludeTags,
    tagsMode: opts.tagsMode,
  });

  const all: { name: string; path: string | null }[] = [];
  for (const refKey of refs) {
    const result = filterBacklinkRef(refKey, state, opts.folder, cf);
    if (result) all.push(result);
  }
  all.sort((a, b) => a.name.localeCompare(b.name));

  return paginate(all, opts);
}

export function batchFindBacklinks(
  names: string[],
  state: GraphState,
  opts: PaginationOpts & FilterOptions = {},
) {
  const results: {
    name: string;
    backlinks: PaginatedResult<{ name: string; path: string | null }>;
  }[] = [];
  const errors: { name: string; error: string }[] = [];

  for (const name of names) {
    const note = resolve(name, state);
    if (note) {
      results.push({
        name: note.name,
        backlinks: backlinks(note.name, state, opts),
      });
    } else {
      errors.push({ name, error: `Note '${name}' not found` });
    }
  }

  return { results, errors };
}

export function orphans(
  state: GraphState,
  opts: PaginationOpts & FilterOptions = {},
): PaginatedResult<{
  name: string;
  path: string;
  tags: string[];
  frontmatterTags: string[];
  inlineTags: string[];
  content_length: number;
  empty: boolean;
}> {
  const cf = compileFilter(opts);

  // If excludePattern was provided but didn't compile, return empty (matching existing convention)
  if (opts.excludePattern && !cf.excludeRe) {
    return {
      total: 0,
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 50,
      results: [],
    };
  }

  const orphanList: {
    name: string;
    path: string;
    tags: string[];
    frontmatterTags: string[];
    inlineTags: string[];
    content_length: number;
    empty: boolean;
  }[] = [];
  for (const [key, note] of state.notes) {
    if (!passesCompiledFilter(note, state.vaultPath, cf)) continue;
    const refs = state.backward.get(key);
    if (!refs || refs.size === 0) {
      const bodyLines = stripFrontmatterLines(note.content.split(/\r?\n/));
      const bodyText = bodyLines.join("\n").trim();
      orphanList.push({
        name: note.name,
        path: note.path,
        tags: allTags(note),
        frontmatterTags: note.frontmatterTags,
        inlineTags: note.inlineTags,
        content_length: note.content.length,
        empty: bodyText.length === 0,
      });
    }
  }
  orphanList.sort((a, b) => a.name.localeCompare(b.name));

  return paginate(orphanList, opts);
}

type BrokenLinkType = "note" | "embed" | "all";

const HAS_EXTENSION = /\.\w{1,5}$/;

function passesTypeFilter(name: string, type: BrokenLinkType): boolean {
  if (type === "all") return true;
  const isEmbed = HAS_EXTENSION.test(name);
  return type === "embed" ? isEmbed : !isEmbed;
}

function buildScopeKeys(
  noteNames: string[] | undefined,
  state: GraphState,
): Set<string> | null {
  if (!noteNames) return null;
  const keys = new Set<string>();
  for (const n of noteNames) {
    const resolved = resolve(n, state);
    if (resolved) keys.add(normalize(resolved.name));
  }
  return keys;
}

function filterMissingEntry(
  name: string,
  referrers: Set<string>,
  type: BrokenLinkType,
  scopeKeys: Set<string> | null,
  state: GraphState,
  cf: CompiledFilter,
): { name: string; referenced_by: string[]; count: number } | null {
  if (!passesTypeFilter(name, type)) return null;

  const filteredReferrers = [...referrers].filter((refKey) => {
    if (scopeKeys && !scopeKeys.has(refKey)) return false;
    const note = state.notes.get(refKey);
    if (!note) return false;
    return passesCompiledFilter(note, state.vaultPath, cf);
  });
  if (filteredReferrers.length === 0) return null;

  return {
    name,
    referenced_by: filteredReferrers,
    count: filteredReferrers.length,
  };
}

export function missingNotes(
  state: GraphState,
  opts: PaginationOpts &
    FilterOptions & {
      type?: BrokenLinkType;
      noteNames?: string[];
    } = {},
): PaginatedResult<{ name: string; referenced_by: string[]; count: number }> {
  const type = opts.type ?? "all";
  const cf = compileFilter(opts);
  const scopeKeys = buildScopeKeys(opts.noteNames, state);

  const missingList: {
    name: string;
    referenced_by: string[];
    count: number;
  }[] = [];
  for (const [name, referrers] of state.missing) {
    const entry = filterMissingEntry(
      name,
      referrers,
      type,
      scopeKeys,
      state,
      cf,
    );
    if (entry) missingList.push(entry);
  }
  missingList.sort((a, b) => b.count - a.count);

  return paginate(missingList, opts);
}

function isReferrerInScope(
  refKey: string,
  scopeKeys: Set<string> | null,
  state: GraphState,
  cf: CompiledFilter,
): boolean {
  if (scopeKeys && !scopeKeys.has(refKey)) return false;
  const note = state.notes.get(refKey);
  if (!note) return false;
  return passesCompiledFilter(note, state.vaultPath, cf);
}

function collectBySource(
  state: GraphState,
  type: BrokenLinkType,
  scopeKeys: Set<string> | null,
  cf: CompiledFilter,
): Map<string, { name: string; is_embed: boolean }[]> {
  const bySource = new Map<string, { name: string; is_embed: boolean }[]>();

  for (const [name, referrers] of state.missing) {
    if (!passesTypeFilter(name, type)) continue;
    const isEmbed = HAS_EXTENSION.test(name);

    for (const refKey of referrers) {
      if (!isReferrerInScope(refKey, scopeKeys, state, cf)) continue;
      if (!bySource.has(refKey)) bySource.set(refKey, []);
      bySource.get(refKey)!.push({ name, is_embed: isEmbed });
    }
  }

  return bySource;
}

export function missingNotesBySource(
  state: GraphState,
  opts: PaginationOpts &
    FilterOptions & {
      type?: BrokenLinkType;
      noteNames?: string[];
    } = {},
): PaginatedResult<{
  source: string;
  source_path: string;
  broken_links: { name: string; is_embed: boolean }[];
  count: number;
}> {
  const type = opts.type ?? "all";
  const cf = compileFilter(opts);
  const scopeKeys = buildScopeKeys(opts.noteNames, state);
  const bySource = collectBySource(state, type, scopeKeys, cf);

  const sourceList = [...bySource.entries()]
    .map(([key, broken_links]) => {
      const note = state.notes.get(key)!;
      return {
        source: note.name,
        source_path: note.path,
        broken_links,
        count: broken_links.length,
      };
    })
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  return paginate(sourceList, opts);
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- BFS neighbor processing with exclude/link-type detection
function processNeighbors(
  sourceKey: string,
  depth: number,
  state: GraphState,
  excludePrefixes: string[],
  linkTypes: Map<string, "wikilink" | "embed">,
  missingFound: Set<string>,
  queue: [string, number][],
): void {
  const sourceNote = state.notes.get(sourceKey);
  if (!sourceNote) return;

  const targets = state.forward.get(sourceKey);
  if (!targets) return;

  for (const target of targets) {
    if (!state.notes.has(target)) {
      missingFound.add(target);
      continue;
    }

    if (excludePrefixes.length > 0) {
      const targetNote = state.notes.get(target)!;
      const relPath = targetNote.path.slice(state.vaultPath.length + 1);
      if (excludePrefixes.some((p) => relPath.startsWith(p))) continue;
    }

    if (!linkTypes.has(target)) {
      const wl = sourceNote.wikilinks.find((w) => normalize(w.name) === target);
      if (wl) {
        linkTypes.set(target, wl.embed ? "embed" : "wikilink");
      }
    }

    queue.push([target, depth + 1]);
  }
}

export function traverse(
  noteName: string | string[],
  maxDepth: number,
  state: GraphState,
  opts: { excludeFolders?: string[] } = {},
) {
  const names = Array.isArray(noteName) ? noteName : [noteName];
  const isMultiRoot = Array.isArray(noteName);

  const startNotes: Note[] = [];
  for (const n of names) {
    const note = resolve(n, state);
    if (!note) {
      return {
        error: `Note '${n}' not found`,
        notes: [],
        missing: [],
      };
    }
    startNotes.push(note);
  }

  const excludePrefixes = (opts.excludeFolders ?? []).map(ensureTrailingSlash);

  const visited = new Map<string, number>();
  const missingFound = new Set<string>();
  const linkTypes = new Map<string, "wikilink" | "embed">();

  // BFS
  const queue: [string, number][] = [];
  for (const note of startNotes) {
    const key = normalize(note.name);
    queue.push([key, 0]);
  }

  let head = 0;
  while (head < queue.length) {
    const [key, depth] = queue[head++];
    if (visited.has(key)) continue;
    visited.set(key, depth);

    if (depth < maxDepth) {
      processNeighbors(
        key,
        depth,
        state,
        excludePrefixes,
        linkTypes,
        missingFound,
        queue,
      );
    }
  }

  const notes = [...visited.entries()]
    .map(([key, depth]) => {
      const note = state.notes.get(key)!;
      return {
        name: note.name,
        path: note.path,
        depth,
        frontmatter: note.frontmatter,
        tags: allTags(note),
        frontmatterTags: note.frontmatterTags,
        inlineTags: note.inlineTags,
        link_type: (linkTypes.get(key) as "wikilink" | "embed" | null) ?? null,
      };
    })
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  const missingResult = [...missingFound].map((name) => {
    const referrers = state.missing.get(name);
    return {
      name,
      referenced_by: referrers ? [...referrers] : [],
    };
  });

  return {
    ...(isMultiRoot
      ? { roots: startNotes.map((n) => n.name) }
      : { root: startNotes[0].name }),
    depth: maxDepth,
    notes,
    missing: missingResult,
  };
}

export function stats(state: GraphState, opts: FilterOptions = {}) {
  const inScope = filterNotes(state.notes, state.vaultPath, opts);

  let tagged = 0;
  let orphanCount = 0;
  for (const [key, note] of inScope) {
    if (note.frontmatterTags.length > 0 || note.inlineTags.length > 0) tagged++;
    const refs = state.backward.get(key);
    if (!refs || refs.size === 0) orphanCount++;
  }

  // Count missing links referenced only by in-scope notes
  let missingCount = 0;
  for (const [, referrers] of state.missing) {
    if ([...referrers].some((refKey) => inScope.has(refKey))) missingCount++;
  }

  return {
    total_notes: inScope.size,
    tagged,
    untagged: inScope.size - tagged,
    orphans: orphanCount,
    missing_links: missingCount,
  };
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeFuzzy(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[-_]/g, "")
      .normalize("NFD")
      // Keep only printable ASCII for fuzzy matching (strips diacritics, control chars, etc.)
      .replace(/[^\u0020-\u007E]/g, "")
  );
}
