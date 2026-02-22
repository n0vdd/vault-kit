defmodule VaultKit.MarkdownTest do
  use ExUnit.Case, async: true

  alias VaultKit.Markdown

  @note_a File.read!(Path.join([__DIR__, "..", "fixtures", "Note A.md"]))

  describe "extract_wikilinks/1" do
    test "extracts plain wikilinks" do
      links = Markdown.extract_wikilinks("Hello [[Note B]] and [[Note C]]")
      names = Enum.map(links, & &1.name)
      assert "Note B" in names
      assert "Note C" in names
      assert Enum.all?(links, &(&1.embed? == false))
    end

    test "extracts wikilinks with headings" do
      links = Markdown.extract_wikilinks("See [[Note B#Section One]]")
      assert [%{name: "Note B", heading: "Section One", embed?: false}] = links
    end

    test "extracts wikilinks with aliases" do
      links = Markdown.extract_wikilinks("Check [[Note C|See Note C]]")
      assert [%{name: "Note C", alias: "See Note C", embed?: false}] = links
    end

    test "extracts embeds" do
      links = Markdown.extract_wikilinks("Here: ![[diagram.png]]")
      assert [%{name: "diagram.png", embed?: true}] = links
    end

    test "extracts all link types from note_a" do
      links = Markdown.extract_wikilinks(@note_a)
      names = Enum.map(links, & &1.name)
      assert "Note B" in names
      assert "Note C" in names
      assert "diagram.png" in names

      embeds = Enum.filter(links, & &1.embed?)
      assert length(embeds) == 1
      assert hd(embeds).name == "diagram.png"
    end

    test "includes line numbers" do
      links = Markdown.extract_wikilinks("line1\n[[Note B]]\nline3")
      assert [%{name: "Note B", line: 2}] = links
    end
  end

  describe "extract_frontmatter/1" do
    test "parses YAML frontmatter" do
      assert {:ok, fm} = Markdown.extract_frontmatter(@note_a)
      assert fm["tags"] == ["project", "active"]
      assert fm["status"] == "draft"
    end

    test "returns :none when no frontmatter" do
      assert :none = Markdown.extract_frontmatter("# Just a heading\n\nSome content.")
    end

    test "returns :none for empty content" do
      assert :none = Markdown.extract_frontmatter("")
    end
  end

  describe "extract_headings/1" do
    test "extracts headings with levels" do
      headings = Markdown.extract_headings(@note_a)
      assert Enum.any?(headings, &(&1.level == 1 && &1.text == "Note A"))
      assert Enum.any?(headings, &(&1.level == 2 && &1.text == "Tasks"))
    end

    test "detects multiple heading levels" do
      content = "# H1\n## H2\n### H3\n#### H4"
      headings = Markdown.extract_headings(content)
      assert length(headings) == 4
      assert Enum.map(headings, & &1.level) == [1, 2, 3, 4]
    end
  end

  describe "extract_checkboxes/1" do
    test "extracts checked and unchecked tasks" do
      boxes = Markdown.extract_checkboxes(@note_a)
      checked = Enum.filter(boxes, & &1.checked?)
      unchecked = Enum.reject(boxes, & &1.checked?)

      assert length(checked) == 1
      assert hd(checked).text == "Completed task"
      assert length(unchecked) == 2
    end

    test "captures indent level" do
      boxes = Markdown.extract_checkboxes(@note_a)
      nested = Enum.find(boxes, &(&1.text == "Nested pending task"))
      assert nested.indent > 0
    end
  end

  describe "extract_inline_tags/1" do
    test "extracts inline tags" do
      tags = Markdown.extract_inline_tags(@note_a)
      assert "tag1" in tags
      assert "nested/tag2" in tags
    end

    test "excludes heading markers" do
      tags = Markdown.extract_inline_tags("# Heading\n\nSome #real_tag here")
      refute Enum.any?(tags, &String.starts_with?(&1, " "))
      assert "real_tag" in tags
    end

    test "does not match tags inside words" do
      tags = Markdown.extract_inline_tags("email foo#bar baz")
      refute "bar" in tags
    end

    test "does not include frontmatter tags" do
      content = "---\ntags:\n  - yaml_tag\n---\n\nSome #inline_tag here"
      tags = Markdown.extract_inline_tags(content)
      assert "inline_tag" in tags
      refute "yaml_tag" in tags
    end
  end
end
