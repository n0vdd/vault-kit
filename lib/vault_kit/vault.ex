defmodule VaultKit.Vault do
  @moduledoc """
  Scans and reads notes from an Obsidian vault directory.
  """

  alias VaultKit.{Markdown, Note}

  @excluded_dirs ~w(.obsidian smart-chats templates .claude Excalidraw .trash)
  @excluded_prefixes ["TagsRoutes/reports/"]

  @doc """
  Scans the vault directory and returns a list of all .md file paths,
  excluding internal Obsidian directories.
  """
  @spec scan(String.t()) :: [String.t()]
  def scan(vault_path) do
    vault_path
    |> Path.join("**/*.md")
    |> Path.wildcard()
    |> Enum.reject(&excluded?(&1, vault_path))
    |> Enum.sort()
  end

  @doc """
  Reads a markdown file and returns a parsed %Note{} struct.
  """
  @spec read_note(String.t()) :: {:ok, Note.t()} | {:error, term()}
  def read_note(path) do
    case File.read(path) do
      {:ok, content} ->
        name = path |> Path.basename() |> Path.rootname()

        frontmatter =
          case Markdown.extract_frontmatter(content) do
            {:ok, fm} -> fm
            :none -> nil
          end

        fm_tags = extract_frontmatter_tags(frontmatter)
        inline_tags = Markdown.extract_inline_tags(content)
        all_tags = Enum.uniq(fm_tags ++ inline_tags)

        note = %Note{
          path: path,
          name: name,
          content: content,
          frontmatter: frontmatter,
          wikilinks: Markdown.extract_wikilinks(content),
          tags: all_tags,
          headings: Markdown.extract_headings(content),
          checkboxes: Markdown.extract_checkboxes(content)
        }

        {:ok, note}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp excluded?(path, vault_path) do
    relative = Path.relative_to(path, vault_path)
    parts = Path.split(relative)

    Enum.any?(parts, &(&1 in @excluded_dirs)) ||
      Enum.any?(@excluded_prefixes, &String.starts_with?(relative, &1))
  end

  defp extract_frontmatter_tags(nil), do: []

  defp extract_frontmatter_tags(fm) when is_map(fm) do
    case Map.get(fm, "tags") do
      tags when is_list(tags) -> Enum.map(tags, &to_string/1)
      tag when is_binary(tag) -> [tag]
      _ -> []
    end
  end
end
