defmodule VaultKit.Note do
  @moduledoc """
  Struct representing a parsed Obsidian vault note.
  """

  @type t :: %__MODULE__{
          path: String.t(),
          name: String.t(),
          content: String.t(),
          frontmatter: map() | nil,
          wikilinks: [map()],
          tags: [String.t()],
          headings: [map()],
          checkboxes: [map()]
        }

  defstruct [
    :path,
    :name,
    :content,
    frontmatter: nil,
    wikilinks: [],
    tags: [],
    headings: [],
    checkboxes: []
  ]
end
