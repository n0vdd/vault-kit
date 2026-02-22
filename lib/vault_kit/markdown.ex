defmodule VaultKit.Markdown do
  @moduledoc """
  Extracts structured data from Obsidian-flavored markdown.

  All functions take a raw markdown string and return structured data.
  """

  @wikilink_re ~r/\[\[([^\]#|]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/
  @embed_re ~r/!\[\[([^\]]+)\]\]/
  @heading_re ~r/^(\#{1,6})\s+(.+)$/m
  @checkbox_re ~r/^(\s*)- \[([ xX])\]\s+(.+)$/m
  @tag_re ~r/(?:^|(?<=\s))\#([a-zA-Z][\w\/\-]*)(?=\s|$)/m
  @frontmatter_re ~r/\A---\r?\n(.*?\r?\n)---\r?\n/s

  @doc """
  Extracts wikilinks from markdown content.

  Returns a list of maps with :name, :heading, :alias, :line, and :embed? keys.
  """
  @spec extract_wikilinks(String.t()) :: [map()]
  def extract_wikilinks(content) do
    lines = String.split(content, ~r/\r?\n/)

    embeds = extract_embeds(lines)
    links = extract_plain_links(lines)

    (embeds ++ links)
    |> Enum.sort_by(& &1.line)
  end

  defp extract_embeds(lines) do
    lines
    |> Enum.with_index(1)
    |> Enum.flat_map(fn {line, line_num} ->
      Regex.scan(@embed_re, line)
      |> Enum.map(fn [_full, target] ->
        case Regex.run(@wikilink_re, "[[#{target}]]") do
          nil -> %{name: String.trim(target), heading: nil, alias: nil}
          match -> parse_wikilink_match(match)
        end
        |> Map.merge(%{line: line_num, embed?: true})
      end)
    end)
  end

  defp extract_plain_links(lines) do
    lines
    |> Enum.with_index(1)
    |> Enum.flat_map(fn {line, line_num} ->
      cleaned = Regex.replace(@embed_re, line, "")

      Regex.scan(@wikilink_re, cleaned)
      |> Enum.map(fn match ->
        parse_wikilink_match(match)
        |> Map.merge(%{line: line_num, embed?: false})
      end)
    end)
  end

  defp parse_wikilink_match([_, name, heading, display]) do
    %{
      name: String.trim(name),
      heading: if(heading != "", do: heading, else: nil),
      alias: if(display != "", do: display, else: nil)
    }
  end

  defp parse_wikilink_match([_, name, heading]) do
    %{
      name: String.trim(name),
      heading: if(heading != "", do: heading, else: nil),
      alias: nil
    }
  end

  defp parse_wikilink_match([_, name]) do
    %{name: String.trim(name), heading: nil, alias: nil}
  end

  @doc """
  Extracts and parses YAML frontmatter from markdown content.

  Returns `{:ok, map}` if frontmatter is found and parsed, or `:none`.
  """
  @spec extract_frontmatter(String.t()) :: {:ok, map()} | :none
  def extract_frontmatter(content) do
    case Regex.run(@frontmatter_re, content) do
      [_, yaml_str] ->
        case YamlElixir.read_from_string(yaml_str) do
          {:ok, parsed} when is_map(parsed) -> {:ok, parsed}
          _ -> :none
        end

      nil ->
        :none
    end
  end

  @doc """
  Extracts headings from markdown content.

  Returns a list of maps with :level, :text, and :line keys.
  """
  @spec extract_headings(String.t()) :: [map()]
  def extract_headings(content) do
    content
    |> String.split(~r/\r?\n/)
    |> Enum.with_index(1)
    |> Enum.flat_map(fn {line, line_num} ->
      case Regex.run(@heading_re, line) do
        [_, hashes, text] ->
          [%{level: String.length(hashes), text: String.trim(text), line: line_num}]

        nil ->
          []
      end
    end)
  end

  @doc """
  Extracts checkbox/task items from markdown content.

  Returns a list of maps with :checked?, :text, :line, and :indent keys.
  """
  @spec extract_checkboxes(String.t()) :: [map()]
  def extract_checkboxes(content) do
    content
    |> String.split(~r/\r?\n/)
    |> Enum.with_index(1)
    |> Enum.flat_map(fn {line, line_num} ->
      case Regex.run(@checkbox_re, line) do
        [_, indent, check, text] ->
          [
            %{
              checked?: check in ["x", "X"],
              text: String.trim(text),
              line: line_num,
              indent: String.length(indent)
            }
          ]

        nil ->
          []
      end
    end)
  end

  @doc """
  Extracts inline tags (e.g. #tag, #nested/tag) from markdown content.

  Excludes heading markers. Returns a deduplicated list of tag strings.
  """
  @spec extract_inline_tags(String.t()) :: [String.t()]
  def extract_inline_tags(content) do
    # Strip frontmatter so YAML tags aren't matched
    body = strip_frontmatter(content)

    body
    |> String.split(~r/\r?\n/)
    |> Enum.reject(fn line -> Regex.match?(~r/^\s*\#{1,6}\s+/, line) end)
    |> Enum.flat_map(fn line ->
      Regex.scan(@tag_re, line)
      |> Enum.map(fn [_, tag] -> tag end)
    end)
    |> Enum.uniq()
  end

  @doc """
  Returns the markdown body without frontmatter.
  """
  @spec strip_frontmatter(String.t()) :: String.t()
  def strip_frontmatter(content) do
    Regex.replace(@frontmatter_re, content, "")
  end
end
