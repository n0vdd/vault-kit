defmodule VaultKit.GraphTest do
  use ExUnit.Case

  alias VaultKit.Graph

  @fixtures_path Path.join([__DIR__, "..", "fixtures"])

  setup do
    start_supervised!({Graph, vault_path: @fixtures_path})
    :ok
  end

  describe "resolve/1" do
    test "resolves exact name (case-insensitive)" do
      assert {:ok, note} = Graph.resolve("Note A")
      assert note.name == "Note A"
    end

    test "resolves mixed case" do
      assert {:ok, note} = Graph.resolve("note a")
      assert note.name == "Note A"
    end

    test "returns :not_found for missing notes" do
      assert :not_found = Graph.resolve("nonexistent_note")
    end
  end

  describe "backlinks/1" do
    test "finds notes linking to the given note" do
      refs = Graph.backlinks("Note B")
      names = Enum.map(refs, & &1.name)

      # Note A links to Note B, Note C links to Note B
      assert "Note A" in names
      assert "Note C" in names
    end

    test "returns empty for notes with no backlinks" do
      refs = Graph.backlinks("Orphan Note")
      assert refs == []
    end
  end

  describe "orphans/1" do
    test "finds notes with no incoming links" do
      result = Graph.orphans()
      names = Enum.map(result.results, & &1.name)

      # Orphan Note has no incoming links
      assert "Orphan Note" in names
      assert result.total > 0
    end

    test "respects limit and offset" do
      result = Graph.orphans(limit: 1, offset: 0)
      assert length(result.results) <= 1
      assert result.limit == 1
      assert result.offset == 0
    end
  end

  describe "missing_notes/1" do
    test "finds broken links" do
      result = Graph.missing_notes()
      names = Enum.map(result.results, & &1.name)

      # Note B links to "Missing Note" which doesn't exist
      assert "missing note" in names
      assert result.total > 0
    end

    test "includes reference count" do
      result = Graph.missing_notes()
      missing_note = Enum.find(result.results, &(&1.name == "missing note"))

      assert missing_note != nil
      assert missing_note.count >= 1
    end

    test "respects limit and offset" do
      result = Graph.missing_notes(limit: 1, offset: 0)
      assert length(result.results) <= 1
      assert result.limit == 1
      assert result.offset == 0
    end
  end

  describe "traverse/2" do
    test "traverses from a note to depth 1" do
      result = Graph.traverse("Note A", 1)
      names = Enum.map(result.notes, & &1.name)

      assert "Note A" in names
      assert "Note B" in names
      assert "Note C" in names
    end

    test "traverses from a note to depth 2" do
      result = Graph.traverse("Note A", 2)
      names = Enum.map(result.notes, & &1.name)

      assert "Note A" in names
      assert "Note B" in names
      assert "Note C" in names
    end

    test "reports missing links during traversal" do
      result = Graph.traverse("Note A", 2)
      missing_names = Enum.map(result.missing, & &1.name)

      assert "missing note" in missing_names
    end

    test "returns error for nonexistent start note" do
      result = Graph.traverse("nonexistent", 1)
      assert result.error != nil
    end

    test "includes depth information" do
      result = Graph.traverse("Note A", 1)
      root = Enum.find(result.notes, &(&1.name == "Note A"))
      assert root.depth == 0
    end
  end

  describe "stats/0" do
    test "returns vault statistics" do
      stats = Graph.stats()

      assert stats.total_notes == 4
      assert stats.tagged > 0
      assert stats.missing_links > 0
      assert is_integer(stats.orphans)
      assert is_integer(stats.untagged)
    end
  end

  describe "search/2" do
    test "finds matching lines across notes" do
      result = Graph.search("note B")
      assert result.total > 0
      assert Enum.any?(result.results, &(&1.file == "Note A"))
    end

    test "is case-insensitive" do
      r1 = Graph.search("Section One")
      r2 = Graph.search("section one")
      assert r1.total == r2.total
    end

    test "respects limit and offset" do
      result = Graph.search("note", limit: 2, offset: 0)
      assert length(result.results) <= 2
      assert result.limit == 2
      assert result.offset == 0
    end

    test "returns empty results for unmatched query" do
      result = Graph.search("zzz_nonexistent_zzz")
      assert result.total == 0
      assert result.results == []
    end
  end

  describe "rebuild/0" do
    test "rebuilds the graph" do
      assert :ok = Graph.rebuild()
      # Should still work after rebuild
      stats = Graph.stats()
      assert stats.total_notes == 4
    end
  end
end
