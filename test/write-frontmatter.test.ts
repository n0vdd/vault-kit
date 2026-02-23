import { describe, test, expect, beforeEach } from "vitest";
import { join } from "path";
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import {
  buildGraph,
  resolve,
  refreshNote,
  type GraphState,
} from "../src/graph.js";
import { allTags } from "../src/types.js";
import { extractFrontmatter, replaceFrontmatter } from "../src/markdown.js";

const fixturesPath = join(__dirname, "fixtures");

function makeTempVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "vault-kit-test-"));
  cpSync(fixturesPath, dir, { recursive: true });
  return dir;
}

describe("write_frontmatter merge logic", () => {
  let tmpVault: string;
  let state: GraphState;

  beforeEach(() => {
    tmpVault = makeTempVault();
    state = buildGraph(tmpVault);
  });

  test("adds tags to a note with existing tags", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    // Merge new tags
    const existingTags = fm.tags as string[];
    const merged = [...new Set([...existingTags, "newtag"])].sort((a, b) =>
      a.localeCompare(b),
    );
    fm.tags = merged;

    const newContent = replaceFrontmatter(content, fm);
    writeFileSync(note.path, newContent, "utf-8");
    refreshNote(note.path, state);

    const updated = resolve("Note A", state)!;
    expect(updated.frontmatterTags).toContain("newtag");
    expect(updated.frontmatterTags).toContain("project");
    expect(updated.frontmatterTags).toContain("active");
  });

  test("adds tags to a note with no frontmatter", () => {
    // Create a note with no frontmatter
    const noFmPath = join(tmpVault, "NoFrontmatter.md");
    writeFileSync(noFmPath, "# No FM\n\nJust content.\n", "utf-8");
    state = buildGraph(tmpVault);

    const note = resolve("NoFrontmatter", state)!;
    expect(note.frontmatter).toBeNull();

    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content) ?? {};
    fm.tags = ["added"];
    const newContent = replaceFrontmatter(content, fm);
    writeFileSync(note.path, newContent, "utf-8");
    refreshNote(note.path, state);

    const updated = resolve("NoFrontmatter", state)!;
    expect(updated.frontmatterTags).toContain("added");
    expect(updated.content).toContain("# No FM");
  });

  test("adds links to frontmatter", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    fm.links = ["[[Note B]]", "[[Note C]]"];
    const newContent = replaceFrontmatter(content, fm);
    writeFileSync(note.path, newContent, "utf-8");
    refreshNote(note.path, state);

    const updated = resolve("Note A", state)!;
    expect(updated.frontmatter!.links).toEqual(["[[Note B]]", "[[Note C]]"]);
  });

  test("merge-only: never removes existing tags", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    const existingTags = fm.tags as string[];
    const newTags = ["extra"];
    fm.tags = [...new Set([...existingTags, ...newTags])].sort((a, b) =>
      a.localeCompare(b),
    );

    const newContent = replaceFrontmatter(content, fm);
    writeFileSync(note.path, newContent, "utf-8");
    refreshNote(note.path, state);

    const updated = resolve("Note A", state)!;
    // All original tags preserved
    expect(updated.frontmatterTags).toContain("project");
    expect(updated.frontmatterTags).toContain("active");
    expect(updated.frontmatterTags).toContain("extra");
  });

  test("preserves existing frontmatter keys", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    expect(fm.status).toBe("draft");
    fm.tags = [...(fm.tags as string[]), "new"];

    const newContent = replaceFrontmatter(content, fm);
    writeFileSync(note.path, newContent, "utf-8");
    refreshNote(note.path, state);

    const updated = resolve("Note A", state)!;
    expect(updated.frontmatter!.status).toBe("draft");
  });

  test("deduplicates tags", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    const existing = fm.tags as string[];
    // Add a tag that already exists
    fm.tags = [...new Set([...existing, "project"])].sort((a, b) =>
      a.localeCompare(b),
    );

    const newContent = replaceFrontmatter(content, fm);
    const parsedBack = extractFrontmatter(newContent)!;
    const tagCount = (parsedBack.tags as string[]).filter(
      (t) => t === "project",
    ).length;
    expect(tagCount).toBe(1);
  });

  test("deduplicates links", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    fm.links = ["[[Note B]]"];
    let newContent = replaceFrontmatter(content, fm);
    writeFileSync(note.path, newContent, "utf-8");

    // Add the same link again
    const content2 = readFileSync(note.path, "utf-8");
    const fm2 = extractFrontmatter(content2)!;
    const existingLinks = fm2.links as string[];
    fm2.links = [...new Set([...existingLinks, "[[Note B]]", "[[Note C]]"])];
    newContent = replaceFrontmatter(content2, fm2);
    writeFileSync(note.path, newContent, "utf-8");

    const parsed = extractFrontmatter(newContent)!;
    const linkCount = (parsed.links as string[]).filter(
      (l) => l === "[[Note B]]",
    ).length;
    expect(linkCount).toBe(1);
    expect(parsed.links).toContain("[[Note C]]");
  });

  test("refreshNote updates graph after write", () => {
    const note = resolve("Orphan Note", state)!;
    expect(note.frontmatterTags).toEqual([]);

    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content) ?? {};
    fm.tags = ["neworphantag"];
    const newContent = replaceFrontmatter(content, fm);
    writeFileSync(note.path, newContent, "utf-8");
    refreshNote(note.path, state);

    const updated = resolve("Orphan Note", state)!;
    expect(updated.frontmatterTags).toContain("neworphantag");
    expect(allTags(updated)).toContain("neworphantag");
  });

  test("body content preserved exactly after frontmatter write", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    // Get body content (after frontmatter)
    const bodyStart = content.indexOf("---\n", 4);
    const body = content.slice(bodyStart + 4);

    fm.tags = [...(fm.tags as string[]), "extra"];
    const newContent = replaceFrontmatter(content, fm);

    // Body should be identical
    const newBodyStart = newContent.indexOf("---\n", 4);
    const newBody = newContent.slice(newBodyStart + 4);
    expect(newBody).toBe(body);
  });
});

describe("aliases merge logic", () => {
  let tmpVault: string;
  let state: GraphState;

  beforeEach(() => {
    tmpVault = makeTempVault();
    state = buildGraph(tmpVault);
  });

  test("adds aliases to a note with no aliases", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    expect(fm.aliases).toBeUndefined();
    fm.aliases = ["Nota A", "First Note"];
    const newContent = replaceFrontmatter(content, fm);
    writeFileSync(note.path, newContent, "utf-8");
    refreshNote(note.path, state);

    const updated = resolve("Note A", state)!;
    expect(updated.frontmatter!.aliases).toEqual(["Nota A", "First Note"]);
  });

  test("merges without duplicating existing aliases", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    fm.aliases = ["Existing Alias"];
    let newContent = replaceFrontmatter(content, fm);
    writeFileSync(note.path, newContent, "utf-8");

    // Now merge again with overlap
    const content2 = readFileSync(note.path, "utf-8");
    const fm2 = extractFrontmatter(content2)!;
    const existing: string[] = Array.isArray(fm2.aliases)
      ? (fm2.aliases as string[])
      : [];
    const incoming = ["Existing Alias", "New Alias"];
    const seen = new Set(existing);
    const merged = [...existing];
    for (const a of incoming) {
      if (!seen.has(a)) {
        seen.add(a);
        merged.push(a);
      }
    }
    fm2.aliases = merged;
    newContent = replaceFrontmatter(content2, fm2);
    writeFileSync(note.path, newContent, "utf-8");

    const parsed = extractFrontmatter(newContent)!;
    const aliasCount = (parsed.aliases as string[]).filter(
      (a) => a === "Existing Alias",
    ).length;
    expect(aliasCount).toBe(1);
    expect(parsed.aliases).toContain("New Alias");
  });

  test("preserves casing of aliases", () => {
    const note = resolve("Note A", state)!;
    const content = readFileSync(note.path, "utf-8");
    const fm = extractFrontmatter(content)!;

    fm.aliases = ["IA", "ia", "Inteligência Artificial"];
    const newContent = replaceFrontmatter(content, fm);
    const parsed = extractFrontmatter(newContent)!;
    expect(parsed.aliases).toEqual(["IA", "ia", "Inteligência Artificial"]);
  });
});

describe("refreshNote upsert", () => {
  test("registers a new note not in the original graph", () => {
    const tmpVault = makeTempVault();
    const state = buildGraph(tmpVault);

    // Create a new note after graph was built
    const newPath = join(tmpVault, "BrandNew.md");
    writeFileSync(
      newPath,
      "---\ntags:\n  - test\n---\n# Brand New\n\nContent with [[Note A]].\n",
      "utf-8",
    );

    // Before upsert, note should not exist
    expect(resolve("BrandNew", state)).toBeNull();

    // refreshNote as upsert
    refreshNote(newPath, state);

    const note = resolve("BrandNew", state);
    expect(note).not.toBeNull();
    expect(note!.name).toBe("BrandNew");
    expect(note!.frontmatterTags).toContain("test");
    expect(note!.content).toContain("# Brand New");
  });

  test("upserted note appears in backward links", () => {
    const tmpVault = makeTempVault();
    const state = buildGraph(tmpVault);

    const newPath = join(tmpVault, "Linker.md");
    writeFileSync(newPath, "# Linker\n\nLinks to [[Note A]].\n", "utf-8");
    refreshNote(newPath, state);

    // "Linker" should now appear in Note A's backlinks
    expect(state.backward.get("note a")?.has("linker")).toBe(true);
  });
});

describe("canonical tag validation", () => {
  test("parseCanonicalTags extracts tags from tags.md", () => {
    const tmpVault = makeTempVault();
    // Create a tags.md in the vault
    writeFileSync(
      join(tmpVault, "tags.md"),
      "# Tags\n\n`software`(253) `ai`(100) `study`(50)\n\nSome `hardware`(10) too.\n",
      "utf-8",
    );
    const state = buildGraph(tmpVault);

    expect(state.canonicalTags.has("software")).toBe(true);
    expect(state.canonicalTags.has("ai")).toBe(true);
    expect(state.canonicalTags.has("study")).toBe(true);
    expect(state.canonicalTags.has("hardware")).toBe(true);
    expect(state.canonicalTags.has("nonexistent")).toBe(false);
  });

  test("empty canonical tags when no tags.md exists", () => {
    const tmpVault = makeTempVault();
    const state = buildGraph(tmpVault);
    expect(state.canonicalTags.size).toBe(0);
  });

  test("unknown tags are flagged with warning", () => {
    const tmpVault = makeTempVault();
    writeFileSync(
      join(tmpVault, "tags.md"),
      "`known_tag`(10) `another`(5)\n",
      "utf-8",
    );
    const state = buildGraph(tmpVault);

    const incomingTags = ["known_tag", "unknown_one", "unknown_two"];
    const unknown = incomingTags.filter(
      (t) => !state.canonicalTags.has(t.toLowerCase()),
    );
    expect(unknown).toEqual(["unknown_one", "unknown_two"]);
  });
});
