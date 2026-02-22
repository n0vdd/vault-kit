defmodule VaultKit.MCPServer.Tools.ResolveWikilink do
  @moduledoc "Resolve a wikilink name to the actual note with content and frontmatter."

  use Hermes.Server.Component, type: :tool

  alias Hermes.Server.Response
  alias VaultKit.Graph

  schema do
    field(:name, {:required, :string}, description: "Wikilink name to resolve (case-insensitive)")
  end

  def execute(%{"name" => name}, frame) do
    case Graph.resolve(name) do
      {:ok, note} ->
        result = %{
          name: note.name,
          path: note.path,
          content: note.content,
          frontmatter: note.frontmatter,
          tags: note.tags
        }

        response =
          Response.tool()
          |> Response.text(Jason.encode!(result))

        {:reply, response, frame}

      :not_found ->
        response =
          Response.tool()
          |> Response.text(Jason.encode!(%{error: "Note '#{name}' not found"}))

        {:reply, response, frame}
    end
  end
end
