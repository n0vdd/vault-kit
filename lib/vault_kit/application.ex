defmodule VaultKit.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    vault_path = System.get_env("VAULT_PATH", "/home/user/Dropbox/notes")

    children =
      [Hermes.Server.Registry] ++
        graph_children(vault_path) ++
        mcp_children()

    opts = [strategy: :one_for_one, name: VaultKit.Supervisor]
    Supervisor.start_link(children, opts)
  end

  defp graph_children(vault_path) do
    if Application.get_env(:vault_kit, :start_graph, true) do
      [{VaultKit.Graph, vault_path: vault_path}]
    else
      []
    end
  end

  defp mcp_children do
    if Application.get_env(:vault_kit, :start_mcp, true) do
      [{VaultKit.MCPServer, transport: :stdio}]
    else
      []
    end
  end
end
