defmodule VaultKit.MCPServer do
  @moduledoc """
  MCP server exposing Obsidian vault operations as tools.
  """

  use Hermes.Server,
    name: "vault-kit",
    version: "0.1.0",
    capabilities: [:tools]

  component(VaultKit.MCPServer.Tools.TraverseLinks)
  component(VaultKit.MCPServer.Tools.FindBacklinks)
  component(VaultKit.MCPServer.Tools.FindOrphans)
  component(VaultKit.MCPServer.Tools.FindMissingNotes)
  component(VaultKit.MCPServer.Tools.ResolveWikilink)
  component(VaultKit.MCPServer.Tools.VaultSearch)
  component(VaultKit.MCPServer.Tools.ReadFrontmatter)
  component(VaultKit.MCPServer.Tools.VaultStats)
end
