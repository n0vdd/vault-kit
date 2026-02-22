defmodule VaultKit.VaultTest do
  use ExUnit.Case, async: true

  alias VaultKit.Vault

  @fixtures_path Path.join([__DIR__, "..", "fixtures"])

  describe "scan/1" do
    test "finds all .md files" do
      paths = Vault.scan(@fixtures_path)
      names = Enum.map(paths, &Path.basename/1)

      assert "Note A.md" in names
      assert "Note B.md" in names
      assert "Note C.md" in names
      assert "Orphan Note.md" in names
    end

    test "excludes .obsidian directory" do
      paths = Vault.scan(@fixtures_path)
      refute Enum.any?(paths, &String.contains?(&1, ".obsidian"))
    end

    test "returns sorted paths" do
      paths = Vault.scan(@fixtures_path)
      assert paths == Enum.sort(paths)
    end
  end

  describe "read_note/1" do
    test "reads and parses a note" do
      path = Path.join(@fixtures_path, "Note A.md")
      assert {:ok, note} = Vault.read_note(path)

      assert note.name == "Note A"
      assert note.path == path
      assert note.frontmatter != nil
      assert "project" in note.tags
      assert "active" in note.tags
      assert note.wikilinks != []
    end

    test "combines frontmatter tags and inline tags" do
      path = Path.join(@fixtures_path, "Note A.md")
      assert {:ok, note} = Vault.read_note(path)

      # Frontmatter tags
      assert "project" in note.tags
      assert "active" in note.tags
      # Inline tags
      assert "tag1" in note.tags
      assert "nested/tag2" in note.tags
    end

    test "returns error for missing file" do
      assert {:error, :enoent} = Vault.read_note("/nonexistent/path.md")
    end
  end
end
