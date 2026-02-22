defmodule VaultKit.MCPServer.Tools.FindOrphans do
  @moduledoc "Find notes with no incoming links (orphans)."

  use Hermes.Server.Component, type: :tool

  alias Hermes.Server.Response
  alias VaultKit.Graph

  schema do
    field(:limit, :integer, description: "Maximum number of results to return (default: 50)")
    field(:offset, :integer, description: "Number of results to skip (default: 0)")
  end

  def execute(params, frame) do
    limit = Map.get(params, "limit", 50)
    offset = Map.get(params, "offset", 0)
    result = Graph.orphans(limit: limit, offset: offset)

    response =
      Response.tool()
      |> Response.text(Jason.encode!(result))

    {:reply, response, frame}
  end
end
