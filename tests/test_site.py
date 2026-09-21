from html.parser import HTMLParser
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


class Markup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.links = []
        self.images = []
        self.meta = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "a":
            self.links.append(attrs)
        if tag == "img":
            self.images.append(attrs)
        if tag == "meta":
            self.meta[attrs.get("property") or attrs.get("name")] = attrs.get("content")


class ProductionReadinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.markup = Markup()
        cls.markup.feed(cls.home)

    def test_homepage_links_and_assets(self):
        for link in self.markup.links:
            href = link.get("href", "")
            if href.startswith("#"):
                self.assertIn(href[1:], self.markup.ids)
            if link.get("target") == "_blank":
                self.assertIn("noopener", link.get("rel", "").split())
                self.assertIn("noreferrer", link.get("rel", "").split())
        for image in self.markup.images:
            self.assertIn("alt", image)
            self.assertIn("width", image)
            self.assertIn("height", image)
            if image.get("src", "").startswith("assets/"):
                self.assertTrue((ROOT / image["src"]).is_file(), image["src"])
        self.assertTrue((ROOT / "assets/apple-touch-icon.png").is_file())

    def test_known_calls_to_action_and_footer_order(self):
        self.assertIn('href="https://luma.com/chipma" target="_blank" rel="noopener noreferrer">Find an event', self.home)
        self.assertIn('href="https://luma.com/chipma" target="_blank" rel="noopener noreferrer">See upcoming events', self.home)
        self.assertIn('>Browse events on Luma ', self.home)
        hero = self.home.split('<section class="hero"', 1)[1].split('</section>', 1)[0]
        self.assertEqual(hero.count('class="button button-primary"'), 1)
        self.assertIn('Join our Slack Community', hero)
        footer = self.home.split('<div class="footer-links">', 1)[1].split('</div>', 1)[0]
        self.assertEqual(
            [part.split('"', 1)[0] for part in footer.split('footer-icon-')[1:]],
            ["luma", "slack", "linkedin", "instagram", "x", "medium"],
        )

    def test_metadata_and_sitemap(self):
        self.assertEqual(self.markup.meta["og:title"], "Chicago Product Management Association | ChiPMA")
        self.assertEqual(self.markup.meta["twitter:card"], "summary_large_image")
        self.assertIn('<link rel="canonical" href="https://chipma.org/">', self.home)
        self.assertEqual((ROOT / "CNAME").read_text(encoding="utf-8").strip(), "chipma.org")
        self.assertIn("Sitemap: https://chipma.org/sitemap.xml", (ROOT / "robots.txt").read_text(encoding="utf-8"))
        sitemap = ET.parse(ROOT / "sitemap.xml")
        namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        self.assertEqual(
            [node.text for node in sitemap.findall("./s:url/s:loc", namespace)],
            ["https://chipma.org/", "https://chipma.org/blog/"],
        )


if __name__ == "__main__":
    unittest.main()
