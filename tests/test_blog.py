import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from scripts import update_blog as blog


class BlogGenerationTests(unittest.TestCase):
    def test_sanitizer_preserves_article_markup_and_removes_executable_content(self):
        fragment = blog.FragmentParser()
        fragment.feed('''<h3>A heading</h3><p onclick="alert(1)">Text <strong>bold</strong>
            <a href="javascript:alert(1)">unsafe</a>
            <a href="https://example.com/read" onmouseover="alert(1)">safe</a></p>
            <blockquote>A quote</blockquote><ol><li>First</li></ol>
            <script>alert(1)</script><iframe src="https://example.com"></iframe>
            <img src="https://medium.com/_/stat?event=tracked" width="1" height="1">
            <img src="https://cdn-images-1.medium.com/photo.png" alt="A photo" onerror="alert(1)">''')
        shift = blog.heading_shift(fragment.root)
        output = "".join(blog.render_node(node, blog.PUBLICATION_URL, shift) for node in fragment.root.children)
        self.assertIn("<h2>A heading</h2>", output)
        self.assertIn("<strong>bold</strong>", output)
        self.assertIn("<blockquote>A quote</blockquote>", output)
        self.assertIn('href="https://example.com/read"', output)
        self.assertIn('alt="A photo"', output)
        for blocked in ("onclick", "onmouseover", "onerror", "javascript:", "<script", "<iframe", "medium.com/_/stat"):
            self.assertNotIn(blocked, output)

    def test_feed_fields_and_stable_slugs(self):
        item = ET.fromstring('''<item xmlns:content="http://purl.org/rss/1.0/modules/content/"
            xmlns:dc="http://purl.org/dc/elements/1.1/">
            <title>Great Product Conversations</title>
            <link>https://medium.com/chicago-product-management-association/great-product-conversations-abc123?source=rss</link>
            <guid>https://medium.com/p/abc123</guid>
            <dc:creator>ChiPMA Author</dc:creator>
            <pubDate>Mon, 09 Sep 2024 15:17:17 GMT</pubDate>
            <content:encoded><![CDATA[<p>Complete article.</p><hr><p><a href="https://medium.com/x">Great Product Conversations</a> was originally published in ChiPMA on Medium.</p>]]></content:encoded>
        </item>''')
        article, body = blog.parse_item(item, {}, {})
        self.assertEqual(article["slug"], "great-product-conversations")
        self.assertEqual(article["author"], "ChiPMA Author")
        self.assertEqual(article["date"], "2024-09-09")
        self.assertEqual(article["url"], "https://medium.com/chicago-product-management-association/great-product-conversations-abc123")
        self.assertEqual(body, "<p>Complete article.</p>")
        existing = {article["guid"]: {**article, "slug": "original-slug"}}
        self.assertEqual(blog.parse_item(item, existing, {"original-slug": article["guid"]})[0]["slug"], "original-slug")

    def test_generated_article_routes_exist(self):
        archive = json.loads((blog.BLOG / "articles.json").read_text(encoding="utf-8"))
        self.assertTrue(archive)
        self.assertTrue((blog.BLOG / "index.html").exists())
        pages = [blog.BLOG / "index.html"]
        for article in archive:
            path = blog.BLOG / article["slug"] / "index.html"
            pages.append(path)
            page = path.read_text(encoding="utf-8")
            self.assertIn('<link rel="canonical" href="' + article["url"] + '">', page)
            self.assertIn('class="article-body"', page)
            self.assertNotIn("medium.com/_/stat", page)
        for path in pages:
            self.assertFalse(
                any(line != line.rstrip() for line in path.read_text(encoding="utf-8").splitlines()),
                f"Trailing whitespace in {path}",
            )

    def test_feed_failure_keeps_last_successful_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            blog_dir = Path(directory)
            (blog_dir / "articles.json").write_text(json.dumps([{
                "guid": "old-guid", "slug": "old-article", "title": "Old article",
                "author": "Author", "date": "2024-01-01", "date_label": "January 1, 2024",
                "url": "https://medium.com/p/old", "image": None, "excerpt": "Still here",
            }]), encoding="utf-8")
            (blog_dir / "index.html").write_text("Previously published", encoding="utf-8")
            with patch.object(blog, "BLOG", blog_dir), patch.object(sys, "argv", ["update_blog.py", "--feed-file", str(blog_dir / "missing.xml")]):
                blog.main()
            self.assertEqual((blog_dir / "index.html").read_text(encoding="utf-8"), "Previously published")

    def test_duplicate_title_gets_stable_unique_slug(self):
        item = ET.fromstring('''<item xmlns:content="http://purl.org/rss/1.0/modules/content/">
            <title>Same Title</title><link>https://medium.com/chi/same-title-abcdef123456</link>
            <guid>https://medium.com/p/abcdef123456</guid>
            <pubDate>Mon, 09 Sep 2024 15:17:17 GMT</pubDate>
            <content:encoded><![CDATA[<p>Complete article.</p>]]></content:encoded>
        </item>''')
        article, _ = blog.parse_item(item, {}, {"same-title": "another-guid"})
        self.assertTrue(article["slug"].startswith("same-title-"))
        self.assertNotEqual(article["slug"], "same-title")


if __name__ == "__main__":
    unittest.main()
