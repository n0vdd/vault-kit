defmodule VaultKit.MCPServer.Tools.ReadFrontmatter do
  @moduledoc "Read and return parsed frontmatter for a given note."

  use Hermes.Server.Component, type: :tool

  alias Hermes.Server.Response
  alias VaultKit.Graph

  schema do
    field(:note_name, {:required, :string},
      description: "Name of the note (without .md extension)"
    )
  end

  def execute(%{"note_name" => name}, frame) do
    case Graph.resolve(name) do
      {:ok, note} ->
        result = %{
          name: note.name,
          path: note.path,
          frontmatter: note.frontmatter || %{}
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
