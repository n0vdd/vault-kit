import Config

# MCP stdio transport uses stdout for JSON-RPC — Logger must go to stderr
config :logger, :default_handler, config: %{type: :standard_error}

import_config "#{config_env()}.exs"
