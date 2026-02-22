defmodule VaultKit.MCPServer.Tools.VaultStats do
  @moduledoc "Return vault-wide statistics: total notes, tagged, untagged, orphans, missing."

  use Hermes.Server.Component, type: :tool

  alias Hermes.Server.Response
  alias VaultKit.Graph

  schema do
  end

  def execute(_params, frame) do
    result = Graph.stats()

    response =
      Response.tool()
      |> Response.text(Jason.encode!(result))

    {:reply, response, frame}
  end
end
