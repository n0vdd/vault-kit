defmodule VaultKit.MCPServer.Tools.FindBacklinks do
  @moduledoc "Find notes that link to the given note."

  use Hermes.Server.Component, type: :tool

  alias Hermes.Server.Response
  alias VaultKit.Graph

  schema do
    field(:note_name, {:required, :string}, description: "Name of the note to find backlinks for")
  end

  def execute(%{"note_name" => name}, frame) do
    result = Graph.backlinks(name)

    response =
      Response.tool()
      |> Response.text(Jason.encode!(result))

    {:reply, response, frame}
  end
end
