import { describe, test, expect } from "vitest";
import {
  compileFilter,
  passesCompiledFilter,
  paginate,
  passesExcludePattern,
  ensureTrailingSlash,
} from "../src/filter.js";
import type { Note } from "../src/types.js";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    path: "/vault/test.md",
    name: "test",
    content: "",
    frontmatter: null,
    wikilinks: [],
    frontmatterTags: [],
    inlineTags: [],
    headings: [],
    checkboxes: [],
    mtime: new Date("2024-06-15"),
    ...overrides,
  };
}

const vaultPath = "/vault";

describe("compileFilter", () => {
  test("returns defaults for empty options", () => {
    const cf = compileFilter({});
    expect(cf.folder).toBeUndefined();
    expect(cf.excludeFolders).toBeUndefined();
    expect(cf.excludeRe).toBeUndefined();
    expect(cf.modifiedAfter).toBeUndefined();
    expect(cf.modifiedBefore).toBeUndefined();
    expect(cf.tagSet).toBeUndefined();
    expect(cf.excludeTagSet).toBeUndefined();
    expect(cf.tagsMode).toBe("any");
  });

  test("compiles folder and excludeFolders", () => {
    const cf = compileFilter({
      folder: "journal",
      excludeFolders: ["templates"],
    });
    expect(cf.folder).toBe("journal");
    expect(cf.excludeFolders).toEqual(["templates"]);
  });

  test("compiles valid exclude pattern", () => {
    const cf = compileFilter({ excludePattern: "^Daily" });
    expect(cf.excludeRe).toBeInstanceOf(RegExp);
    expect(cf.excludeRe!.test("Daily Note")).toBe(true);
    expect(cf.excludeRe!.test("weekly note")).toBe(false);
  });

  test("invalid exclude pattern compiles to undefined", () => {
    const cf = compileFilter({ excludePattern: "[invalid" });
    expect(cf.excludeRe).toBeUndefined();
  });

  test("compiles valid date strings", () => {
    const cf = compileFilter({
      modifiedAfter: "2024-01-01",
      modifiedBefore: "2024-12-31",
    });
    expect(cf.modifiedAfter).toBeInstanceOf(Date);
    expect(cf.modifiedBefore).toBeInstanceOf(Date);
    expect(cf.modifiedAfter!.getFullYear()).toBe(2024);
  });

  test("invalid date strings compile to undefined", () => {
    const cf = compileFilter({
      modifiedAfter: "not-a-date",
      modifiedBefore: "also-invalid",
    });
    expect(cf.modifiedAfter).toBeUndefined();
    expect(cf.modifiedBefore).toBeUndefined();
  });

  test("empty string date compiles to undefined", () => {
    const cf = compileFilter({
      modifiedAfter: "",
      modifiedBefore: "",
    });
    expect(cf.modifiedAfter).toBeUndefined();
    expect(cf.modifiedBefore).toBeUndefined();
  });

  test("normalizes tags with # prefix and lowercases", () => {
    const cf = compileFilter({ tags: ["#Project", "Active"] });
    expect(cf.tagSet).toBeInstanceOf(Set);
    expect(cf.tagSet!.has("project")).toBe(true);
    expect(cf.tagSet!.has("active")).toBe(true);
  });

  test("empty tags array compiles to undefined", () => {
    const cf = compileFilter({ tags: [] });
    expect(cf.tagSet).toBeUndefined();
  });

  test("respects tagsMode", () => {
    expect(compileFilter({ tagsMode: "all" }).tagsMode).toBe("all");
    expect(compileFilter({ tagsMode: "any" }).tagsMode).toBe("any");
    expect(compileFilter({}).tagsMode).toBe("any");
  });
});

describe("passesCompiledFilter", () => {
  test("passes with empty filter", () => {
    const cf = compileFilter({});
    const note = makeNote();
    expect(passesCompiledFilter(note, vaultPath, cf)).toBe(true);
  });

  test("folder filter includes matching notes", () => {
    const cf = compileFilter({ folder: "journal" });
    const note = makeNote({ path: "/vault/journal/daily.md", name: "daily" });
    expect(passesCompiledFilter(note, vaultPath, cf)).toBe(true);
  });

  test("folder filter excludes non-matching notes", () => {
    const cf = compileFilter({ folder: "journal" });
    const note = makeNote({ path: "/vault/projects/todo.md", name: "todo" });
    expect(passesCompiledFilter(note, vaultPath, cf)).toBe(false);
  });

  test("excludeFolders filters notes in excluded folders", () => {
    const cf = compileFilter({ excludeFolders: ["journal", "templates"] });
    expect(
      passesCompiledFilter(
        makeNote({ path: "/vault/journal/daily.md" }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
    expect(
      passesCompiledFilter(
        makeNote({ path: "/vault/templates/t.md" }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
    expect(
      passesCompiledFilter(
        makeNote({ path: "/vault/projects/todo.md" }),
        vaultPath,
        cf,
      ),
    ).toBe(true);
  });

  test("excludePattern filters matching names", () => {
    const cf = compileFilter({ excludePattern: "^Daily" });
    expect(
      passesCompiledFilter(makeNote({ name: "Daily Note" }), vaultPath, cf),
    ).toBe(false);
    expect(
      passesCompiledFilter(makeNote({ name: "Weekly Note" }), vaultPath, cf),
    ).toBe(true);
  });

  test("modifiedAfter filters notes before the date", () => {
    const cf = compileFilter({ modifiedAfter: "2024-06-01" });
    expect(
      passesCompiledFilter(
        makeNote({ mtime: new Date("2024-07-01") }),
        vaultPath,
        cf,
      ),
    ).toBe(true);
    expect(
      passesCompiledFilter(
        makeNote({ mtime: new Date("2024-05-01") }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
  });

  test("modifiedBefore filters notes after the date", () => {
    const cf = compileFilter({ modifiedBefore: "2024-06-01" });
    expect(
      passesCompiledFilter(
        makeNote({ mtime: new Date("2024-05-01") }),
        vaultPath,
        cf,
      ),
    ).toBe(true);
    expect(
      passesCompiledFilter(
        makeNote({ mtime: new Date("2024-07-01") }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
  });

  test("invalid date in modifiedAfter is ignored (passes all)", () => {
    const cf = compileFilter({ modifiedAfter: "not-a-date" });
    expect(passesCompiledFilter(makeNote(), vaultPath, cf)).toBe(true);
  });

  test("invalid date in modifiedBefore is ignored (passes all)", () => {
    const cf = compileFilter({ modifiedBefore: "garbage" });
    expect(passesCompiledFilter(makeNote(), vaultPath, cf)).toBe(true);
  });

  test("tags filter with mode 'any' matches notes with at least one tag", () => {
    const cf = compileFilter({
      tags: ["project", "reference"],
      tagsMode: "any",
    });
    expect(
      passesCompiledFilter(
        makeNote({ frontmatterTags: ["project"] }),
        vaultPath,
        cf,
      ),
    ).toBe(true);
    expect(
      passesCompiledFilter(
        makeNote({ inlineTags: ["reference"] }),
        vaultPath,
        cf,
      ),
    ).toBe(true);
    expect(
      passesCompiledFilter(
        makeNote({ frontmatterTags: ["other"] }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
  });

  test("tags filter with mode 'all' requires every tag", () => {
    const cf = compileFilter({
      tags: ["project", "active"],
      tagsMode: "all",
    });
    expect(
      passesCompiledFilter(
        makeNote({ frontmatterTags: ["project", "active"] }),
        vaultPath,
        cf,
      ),
    ).toBe(true);
    expect(
      passesCompiledFilter(
        makeNote({ frontmatterTags: ["project"] }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
  });

  test("tags mode 'all' matches across frontmatter and inline tags", () => {
    const cf = compileFilter({
      tags: ["project", "tag1"],
      tagsMode: "all",
    });
    expect(
      passesCompiledFilter(
        makeNote({ frontmatterTags: ["project"], inlineTags: ["tag1"] }),
        vaultPath,
        cf,
      ),
    ).toBe(true);
  });

  test("excludeTags filters notes with any excluded tag", () => {
    const cf = compileFilter({ excludeTags: ["draft"] });
    expect(
      passesCompiledFilter(
        makeNote({ frontmatterTags: ["draft", "project"] }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
    expect(
      passesCompiledFilter(
        makeNote({ frontmatterTags: ["project"] }),
        vaultPath,
        cf,
      ),
    ).toBe(true);
  });

  test("combined filters are AND-ed", () => {
    const cf = compileFilter({
      folder: "projects",
      tags: ["active"],
      modifiedAfter: "2024-01-01",
    });
    // Matches all: in projects/, has active tag, modified after 2024-01-01
    expect(
      passesCompiledFilter(
        makeNote({
          path: "/vault/projects/todo.md",
          frontmatterTags: ["active"],
          mtime: new Date("2024-06-01"),
        }),
        vaultPath,
        cf,
      ),
    ).toBe(true);
    // Fails folder
    expect(
      passesCompiledFilter(
        makeNote({
          path: "/vault/journal/daily.md",
          frontmatterTags: ["active"],
          mtime: new Date("2024-06-01"),
        }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
    // Fails tags
    expect(
      passesCompiledFilter(
        makeNote({
          path: "/vault/projects/todo.md",
          frontmatterTags: ["draft"],
          mtime: new Date("2024-06-01"),
        }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
    // Fails date
    expect(
      passesCompiledFilter(
        makeNote({
          path: "/vault/projects/todo.md",
          frontmatterTags: ["active"],
          mtime: new Date("2023-06-01"),
        }),
        vaultPath,
        cf,
      ),
    ).toBe(false);
  });
});

describe("paginate", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  test("defaults to limit 50 and offset 0", () => {
    const result = paginate(items, {});
    expect(result.total).toBe(10);
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(50);
    expect(result.results).toEqual(items);
  });

  test("respects limit", () => {
    const result = paginate(items, { limit: 3 });
    expect(result.results).toEqual([1, 2, 3]);
    expect(result.total).toBe(10);
  });

  test("respects offset", () => {
    const result = paginate(items, { offset: 5 });
    expect(result.results).toEqual([6, 7, 8, 9, 10]);
  });

  test("respects limit and offset together", () => {
    const result = paginate(items, { limit: 3, offset: 2 });
    expect(result.results).toEqual([3, 4, 5]);
  });

  test("offset beyond array length returns empty results", () => {
    const result = paginate(items, { offset: 100 });
    expect(result.results).toEqual([]);
    expect(result.total).toBe(10);
  });

  test("returns empty results for empty array", () => {
    const result = paginate([], { limit: 10 });
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("passesExcludePattern", () => {
  test("returns true when no regex provided", () => {
    expect(passesExcludePattern("anything")).toBe(true);
  });

  test("excludes matching names", () => {
    const re = new RegExp("^Daily", "i");
    expect(passesExcludePattern("Daily Note", re)).toBe(false);
    expect(passesExcludePattern("daily note", re)).toBe(false);
    expect(passesExcludePattern("Weekly Note", re)).toBe(true);
  });
});

describe("ensureTrailingSlash", () => {
  test("adds slash when missing", () => {
    expect(ensureTrailingSlash("journal")).toBe("journal/");
  });

  test("does not double-add slash", () => {
    expect(ensureTrailingSlash("journal/")).toBe("journal/");
  });
});
