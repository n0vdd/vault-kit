defmodule VaultKit.Graph do
  @moduledoc """
  GenServer holding an in-memory link graph of the vault.

  Built on startup by scanning all notes and constructing forward/backward
  adjacency maps for instant link resolution.
  """

  use GenServer

  alias VaultKit.{Note, Vault}

  @type state :: %{
          vault_path: String.t(),
          notes: %{String.t() => Note.t()},
          forward: %{String.t() => MapSet.t()},
          backward: %{String.t() => MapSet.t()},
          missing: %{String.t() => MapSet.t()}
        }

  # Client API

  def start_link(opts) do
    vault_path = Keyword.fetch!(opts, :vault_path)
    GenServer.start_link(__MODULE__, vault_path, name: __MODULE__)
  end

  @doc "BFS traversal from a note to depth N. Returns notes + content + missing links."
  @spec traverse(String.t(), non_neg_integer(), keyword()) :: map()
  def traverse(note_name, depth \\ 2, opts \\ []) do
    GenServer.call(__MODULE__, {:traverse, note_name, depth, opts}, 30_000)
  end

  @doc "Returns notes that link to the given note."
  @spec backlinks(String.t()) :: [map()]
  def backlinks(note_name) do
    GenServer.call(__MODULE__, {:backlinks, note_name})
  end

  @doc "Returns notes with no incoming links."
  @spec orphans(keyword()) :: map()
  def orphans(opts \\ []) do
    GenServer.call(__MODULE__, {:orphans, opts}, 30_000)
  end

  @doc "Returns all broken links with reference counts."
  @spec missing_notes(keyword()) :: map()
  def missing_notes(opts \\ []) do
    GenServer.call(__MODULE__, {:missing_notes, opts}, 30_000)
  end

  @doc "Case-insensitive note lookup with fuzzy fallback."
  @spec resolve(String.t()) :: {:ok, Note.t()} | :not_found
  def resolve(name) do
    GenServer.call(__MODULE__, {:resolve, name})
  end

  @doc "Rebuild the graph from disk."
  @spec rebuild() :: :ok
  def rebuild do
    GenServer.call(__MODULE__, :rebuild, 60_000)
  end

  @doc "Return vault statistics."
  @spec stats() :: map()
  def stats do
    GenServer.call(__MODULE__, :stats, 30_000)
  end

  @doc "Search vault content for a query string."
  @spec search(String.t(), keyword()) :: map()
  def search(query, opts \\ []) do
    GenServer.call(__MODULE__, {:search, query, opts}, 30_000)
  end

  @doc "Return the vault path."
  @spec vault_path() :: String.t()
  def vault_path do
    GenServer.call(__MODULE__, :get_vault_path)
  end

  # Server callbacks

  @impl true
  def init(vault_path) do
    state = build_graph(vault_path)
    {:ok, state}
  end

  @impl true
  def handle_call({:traverse, note_name, depth, _opts}, _from, state) do
    result = do_traverse(note_name, depth, state)
    {:reply, result, state}
  end

  def handle_call({:backlinks, note_name}, _from, state) do
    key = normalize(note_name)

    refs =
      state.backward
      |> Map.get(key, MapSet.new())
      |> MapSet.to_list()
      |> Enum.map(fn ref_key ->
        case Map.get(state.notes, ref_key) do
          nil -> %{name: ref_key, path: nil}
          note -> %{name: note.name, path: note.path}
        end
      end)

    {:reply, refs, state}
  end

  def handle_call({:orphans, opts}, _from, state) do
    limit = Keyword.get(opts, :limit, 50)
    offset = Keyword.get(opts, :offset, 0)

    orphan_list =
      state.notes
      |> Enum.filter(fn {key, _note} ->
        refs = Map.get(state.backward, key, MapSet.new())
        MapSet.size(refs) == 0
      end)
      |> Enum.map(fn {_key, note} ->
        %{name: note.name, path: note.path, tags: note.tags}
      end)
      |> Enum.sort_by(& &1.name)

    total = length(orphan_list)
    page = orphan_list |> Enum.drop(offset) |> Enum.take(limit)

    {:reply, %{total: total, offset: offset, limit: limit, results: page}, state}
  end

  def handle_call({:missing_notes, opts}, _from, state) do
    limit = Keyword.get(opts, :limit, 50)
    offset = Keyword.get(opts, :offset, 0)

    missing_list =
      state.missing
      |> Enum.map(fn {name, referrers} ->
        %{name: name, referenced_by: MapSet.to_list(referrers), count: MapSet.size(referrers)}
      end)
      |> Enum.sort_by(& &1.count, :desc)

    total = length(missing_list)
    page = missing_list |> Enum.drop(offset) |> Enum.take(limit)

    {:reply, %{total: total, offset: offset, limit: limit, results: page}, state}
  end

  def handle_call({:resolve, name}, _from, state) do
    result = do_resolve(name, state)
    {:reply, result, state}
  end

  def handle_call(:rebuild, _from, state) do
    new_state = build_graph(state.vault_path)
    {:reply, :ok, new_state}
  end

  def handle_call(:get_vault_path, _from, state) do
    {:reply, state.vault_path, state}
  end

  def handle_call({:search, query, opts}, _from, state) do
    limit = Keyword.get(opts, :limit, 50)
    offset = Keyword.get(opts, :offset, 0)
    q = String.downcase(query)
    needed = offset + limit

    {total, collected} =
      Enum.reduce(state.notes, {0, []}, fn {_key, note}, {count, acc} ->
        matches =
          note.content
          |> String.split(~r/\r?\n/)
          |> Enum.with_index(1)
          |> Enum.filter(fn {line, _} -> String.contains?(String.downcase(line), q) end)

        new_count = count + length(matches)

        new_acc =
          if length(acc) < needed do
            remaining = needed - length(acc)

            extra =
              matches
              |> Enum.take(remaining)
              |> Enum.map(fn {line, line_num} ->
                %{file: note.name, path: note.path, line: line_num, text: String.trim(line)}
              end)

            acc ++ extra
          else
            acc
          end

        {new_count, new_acc}
      end)

    page = collected |> Enum.drop(offset) |> Enum.take(limit)

    {:reply, %{total: total, offset: offset, limit: limit, results: page}, state}
  end

  def handle_call(:stats, _from, state) do
    total = map_size(state.notes)

    tagged =
      state.notes
      |> Enum.count(fn {_, note} -> note.tags != [] end)

    orphan_count =
      state.notes
      |> Enum.count(fn {key, _} ->
        refs = Map.get(state.backward, key, MapSet.new())
        MapSet.size(refs) == 0
      end)

    result = %{
      total_notes: total,
      tagged: tagged,
      untagged: total - tagged,
      orphans: orphan_count,
      missing_links: map_size(state.missing)
    }

    {:reply, result, state}
  end

  # Private

  defp build_graph(vault_path) do
    paths = Vault.scan(vault_path)

    notes =
      paths
      |> Enum.reduce(%{}, fn path, acc ->
        case Vault.read_note(path) do
          {:ok, note} -> Map.put(acc, normalize(note.name), note)
          {:error, _} -> acc
        end
      end)

    {forward, backward, missing} = build_adjacency(notes)

    %{
      vault_path: vault_path,
      notes: notes,
      forward: forward,
      backward: backward,
      missing: missing
    }
  end

  defp build_adjacency(notes) do
    Enum.reduce(notes, {%{}, %{}, %{}}, fn {source_key, note}, {fwd, bwd, miss} ->
      targets =
        note.wikilinks
        |> Enum.map(fn wl -> normalize(wl.name) end)
        |> Enum.uniq()

      new_fwd = Map.put(fwd, source_key, MapSet.new(targets))

      {new_bwd, new_miss} =
        Enum.reduce(targets, {bwd, miss}, fn target_key, {b, m} ->
          new_b = Map.update(b, target_key, MapSet.new([source_key]), &MapSet.put(&1, source_key))

          new_m =
            if Map.has_key?(notes, target_key) do
              m
            else
              Map.update(m, target_key, MapSet.new([source_key]), &MapSet.put(&1, source_key))
            end

          {new_b, new_m}
        end)

      {new_fwd, new_bwd, new_miss}
    end)
  end

  defp do_traverse(note_name, max_depth, state) do
    start_key = normalize(note_name)

    case do_resolve(note_name, state) do
      {:ok, start_note} ->
        queue = :queue.from_list([{start_key, 0}])
        {visited, missing_found} = bfs(queue, max_depth, state, %{}, MapSet.new())

        notes =
          visited
          |> Enum.map(fn {key, depth} ->
            note = Map.get(state.notes, key)

            %{
              name: note.name,
              path: note.path,
              depth: depth,
              frontmatter: note.frontmatter,
              tags: note.tags
            }
          end)
          |> Enum.sort_by(&{&1.depth, &1.name})

        missing =
          missing_found
          |> MapSet.to_list()
          |> Enum.map(fn name ->
            referrers = Map.get(state.missing, name, MapSet.new())
            %{name: name, referenced_by: MapSet.to_list(referrers)}
          end)

        %{root: start_note.name, depth: max_depth, notes: notes, missing: missing}

      :not_found ->
        %{error: "Note '#{note_name}' not found", notes: [], missing: []}
    end
  end

  defp bfs(queue, max_depth, state, visited, missing) do
    case :queue.out(queue) do
      {:empty, _} ->
        {visited, missing}

      {{:value, {key, depth}}, rest} ->
        if Map.has_key?(visited, key) do
          bfs(rest, max_depth, state, visited, missing)
        else
          new_visited = Map.put(visited, key, depth)

          if depth < max_depth do
            targets = Map.get(state.forward, key, MapSet.new()) |> MapSet.to_list()
            {new_queue, new_missing} = enqueue_targets(targets, depth, state, rest, missing)
            bfs(new_queue, max_depth, state, new_visited, new_missing)
          else
            bfs(rest, max_depth, state, new_visited, missing)
          end
        end
    end
  end

  defp enqueue_targets(targets, depth, state, queue, missing) do
    Enum.reduce(targets, {queue, missing}, fn target, {q, m} ->
      if Map.has_key?(state.notes, target) do
        {:queue.in({target, depth + 1}, q), m}
      else
        {q, MapSet.put(m, target)}
      end
    end)
  end

  defp do_resolve(name, state) do
    key = normalize(name)

    case Map.get(state.notes, key) do
      nil -> fuzzy_resolve(name, state)
      note -> {:ok, note}
    end
  end

  defp fuzzy_resolve(name, state) do
    target = normalize_fuzzy(name)

    result =
      state.notes
      |> Enum.find(fn {_key, note} ->
        normalize_fuzzy(note.name) == target
      end)

    case result do
      {_key, note} -> {:ok, note}
      nil -> :not_found
    end
  end

  defp normalize(name) do
    name |> String.trim() |> String.downcase()
  end

  defp normalize_fuzzy(name) do
    name
    |> String.trim()
    |> String.downcase()
    |> String.replace(~r/[-_]/, "")
    |> String.normalize(:nfd)
    |> String.replace(~r/[^\x00-\x7F]/, "")
  end
end
