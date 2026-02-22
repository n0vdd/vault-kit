#!/usr/bin/env bash
# Pipe JSON-RPC requests to the MCP server and print responses

(
# 1. Initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# 2. Initialized notification
echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# Give it a moment to process
sleep 1

# 3. Test each tool
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vault_stats","arguments":{}}}'
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_backlinks","arguments":{"note_name":"some note"}}}'
echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"find_orphans","arguments":{}}}'
echo '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"find_missing_notes","arguments":{}}}'
echo '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"read_frontmatter","arguments":{"note_name":"some note"}}}'
echo '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"resolve_wikilink","arguments":{"name":"some note"}}}'
echo '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"traverse_links","arguments":{"note_name":"some note","depth":1}}}'
echo '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"vault_search","arguments":{"query":"test"}}}'

sleep 2
) | VAULT_PATH=~/Dropbox/notes mix run --no-halt 2>/dev/null | jq .
