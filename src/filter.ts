import type { Note } from "./types.js";

export interface FilterOptions {
  folder?: string;
  excludeFolders?: string[];
  excludePattern?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  tags?: string[];
  excludeTags?: string[];
  tagsMode?: "any" | "all";
}

export interface PaginationOpts {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  total: number;
  offset: number;
  limit: number;
  results: T[];
}

export interface CompiledFilter {
  folder?: string;
  excludeFolders?: string[];
  excludeRe?: RegExp;
  modifiedAfter?: Date;
  modifiedBefore?: Date;
  tagSet?: Set<string>;
  excludeTagSet?: Set<string>;
  tagsMode: "any" | "all";
}

function compileExcludePattern(pattern?: string): RegExp | undefined {
  if (!pattern) return undefined;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return undefined;
  }
}

function normalizeTagSet(tags?: string[]): Set<string> | undefined {
  if (!tags || tags.length === 0) return undefined;
  return new Set(tags.map((t) => t.replace(/^#/, "").toLowerCase()));
}

export function compileFilter(opts: FilterOptions): CompiledFilter {
  return {
    folder: opts.folder,
    excludeFolders: opts.excludeFolders,
    excludeRe: compileExcludePattern(opts.excludePattern),
    modifiedAfter: opts.modifiedAfter
      ? new Date(opts.modifiedAfter)
      : undefined,
    modifiedBefore: opts.modifiedBefore
      ? new Date(opts.modifiedBefore)
      : undefined,
    tagSet: normalizeTagSet(opts.tags),
    excludeTagSet: normalizeTagSet(opts.excludeTags),
    tagsMode: opts.tagsMode ?? "any",
  };
}

export function paginate<T>(
  items: T[],
  opts: PaginationOpts,
): PaginatedResult<T> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return {
    total: items.length,
    offset,
    limit,
    results: items.slice(offset, offset + limit),
  };
}

export function ensureTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : path + "/";
}

export function isNoteInFolder(
  note: Note,
  vaultPath: string,
  folderPrefix: string,
): boolean {
  const prefix = ensureTrailingSlash(folderPrefix);
  const relPath = note.path.slice(vaultPath.length + 1);
  return relPath.startsWith(prefix);
}

function isNoteInExcludedFolder(
  note: Note,
  vaultPath: string,
  excludeFolders: string[],
): boolean {
  const relPath = note.path.slice(vaultPath.length + 1);
  return excludeFolders.some((f) => relPath.startsWith(ensureTrailingSlash(f)));
}

export function passesExcludePattern(noteName: string, re?: RegExp): boolean {
  if (!re) return true;
  return !re.test(noteName);
}

function hasMatchingTag(note: Note, tagSet: Set<string>): boolean {
  return (
    note.frontmatterTags.some((t) => tagSet.has(t.toLowerCase())) ||
    note.inlineTags.some((t) => tagSet.has(t.toLowerCase()))
  );
}

function hasAllTags(note: Note, tagSet: Set<string>): boolean {
  const noteTags = new Set([
    ...note.frontmatterTags.map((t) => t.toLowerCase()),
    ...note.inlineTags.map((t) => t.toLowerCase()),
  ]);
  for (const tag of tagSet) {
    if (!noteTags.has(tag)) return false;
  }
  return true;
}

function matchesTags(
  note: Note,
  tagSet: Set<string>,
  mode: "any" | "all",
): boolean {
  return mode === "all"
    ? hasAllTags(note, tagSet)
    : hasMatchingTag(note, tagSet);
}

export function passesCompiledFilter(
  note: Note,
  vaultPath: string,
  cf: CompiledFilter,
): boolean {
  if (cf.folder && !isNoteInFolder(note, vaultPath, cf.folder)) return false;
  if (
    cf.excludeFolders &&
    isNoteInExcludedFolder(note, vaultPath, cf.excludeFolders)
  )
    return false;
  if (!passesExcludePattern(note.name, cf.excludeRe)) return false;
  if (cf.modifiedAfter && note.mtime < cf.modifiedAfter) return false;
  if (cf.modifiedBefore && note.mtime > cf.modifiedBefore) return false;
  if (cf.tagSet && !matchesTags(note, cf.tagSet, cf.tagsMode)) return false;
  if (cf.excludeTagSet && hasMatchingTag(note, cf.excludeTagSet)) return false;
  return true;
}

export function filterNotes(
  notes: Map<string, Note>,
  vaultPath: string,
  opts: FilterOptions,
): Map<string, Note> {
  const cf = compileFilter(opts);
  const filtered = new Map<string, Note>();
  for (const [key, note] of notes) {
    if (passesCompiledFilter(note, vaultPath, cf)) {
      filtered.set(key, note);
    }
  }
  return filtered;
}
