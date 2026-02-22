defmodule VaultKit.MCPServer.Tools.TraverseLinks do
  @moduledoc "BFS traversal from a note to depth N, returning notes + content + missing links."

  use Hermes.Server.Component, type: :tool

  alias Hermes.Server.Response
  alias VaultKit.Graph

  schema do
    field(:note_name, {:required, :string},
      description: "Name of the starting note (without .md extension)"
    )

    field(:depth, :integer, description: "Maximum traversal depth (default: 2)")
  end

  def execute(%{"note_name" => name} = params, frame) do
    depth = Map.get(params, "depth", 2)
    result = Graph.traverse(name, depth)

    response =
      Response.tool()
      |> Response.text(Jason.encode!(result))

    {:reply, response, frame}
  end
end
