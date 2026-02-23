import type { Wikilink, Heading, Checkbox } from "./types.js";
import YAML from "yaml";

const WIKILINK_RE = /\[\[([^\]#|]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const EMBED_FULL_RE = /!\[\[([^\]#|]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const EMBED_RE = /!\[\[([^\]]+)\]\]/g;
const TAG_RE = /(?:^|(?<=\s))#([a-zA-Z][\w/-]*)(?=\s|$)/gm;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?\r?\n)---\r?\n/;

export function extractWikilinks(lines: string[]): Wikilink[] {
  const embeds = extractEmbeds(lines);
  const links = extractPlainLinks(lines);
  return [...embeds, ...links].sort((a, b) => a.line - b.line);
}

function extractEmbeds(lines: string[]): Wikilink[] {
  const results: Wikilink[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    for (const match of lines[i].matchAll(EMBED_FULL_RE)) {
      results.push({
        name: match[1].trim(),
        heading: match[2] || null,
        alias: match[3] || null,
        line: lineNum,
        embed: true,
      });
    }
  }
  return results;
}

function extractPlainLinks(lines: string[]): Wikilink[] {
  const results: Wikilink[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cleaned = lines[i].replace(EMBED_RE, "");
    const lineNum = i + 1;
    for (const match of cleaned.matchAll(WIKILINK_RE)) {
      results.push({
        name: match[1].trim(),
        heading: match[2] || null,
        alias: match[3] || null,
        line: lineNum,
        embed: false,
      });
    }
  }
  return results;
}

export function extractFrontmatter(
  content: string,
): Record<string, unknown> | null {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return null;
  try {
    const parsed: unknown = YAML.parse(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractHeadings(lines: string[]): Heading[] {
  const results: Heading[] = [];
  const re = /^(#{1,6})\s+(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const match = re.exec(lines[i]);
    if (match) {
      results.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i + 1,
      });
    }
  }
  return results;
}

export function extractCheckboxes(lines: string[]): Checkbox[] {
  const results: Checkbox[] = [];
  const re = /^(\s*)- \[([ xX])\]\s+(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const match = re.exec(lines[i]);
    if (match) {
      results.push({
        checked: match[2] === "x" || match[2] === "X",
        text: match[3].trim(),
        line: i + 1,
        indent: match[1].length,
      });
    }
  }
  return results;
}

export function extractInlineTags(lines: string[]): string[] {
  const body = stripFrontmatterLines(lines);
  const seen = new Set<string>();
  const results: string[] = [];

  for (const line of body) {
    if (/^\s*#{1,6}\s+/.test(line)) continue;
    for (const match of line.matchAll(TAG_RE)) {
      const tag = match[1];
      if (!seen.has(tag)) {
        seen.add(tag);
        results.push(tag);
      }
    }
  }
  return results;
}

export function serializeFrontmatter(fm: Record<string, unknown>): string {
  const yamlStr = YAML.stringify(fm, { lineWidth: 0 }).trimEnd();
  return `---\n${yamlStr}\n---\n`;
}

export function replaceFrontmatter(
  content: string,
  newFm: Record<string, unknown>,
): string {
  const serialized = serializeFrontmatter(newFm);
  const match = FRONTMATTER_RE.exec(content);
  if (match) {
    return serialized + content.slice(match[0].length);
  }
  return serialized + content;
}

export function stripFrontmatterLines(lines: string[]): string[] {
  if (lines.length === 0 || lines[0] !== "---") return lines;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "---\r") {
      return lines.slice(i + 1);
    }
  }
  return lines;
}
