#!/usr/bin/env python3
"""Build static ChiPMA blog pages from the Medium publication RSS feed."""

import argparse
from dataclasses import dataclass, field
from datetime import timezone
from email.utils import parsedate_to_datetime
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
BLOG = ROOT / "blog"
FEED_URL = "https://medium.com/feed/chicago-product-management-association"
PUBLICATION_URL = "https://medium.com/chicago-product-management-association"
CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}encoded"
CREATOR_NS = "{http://purl.org/dc/elements/1.1/}creator"
ALLOWED_TAGS = {
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a", "img",
    "figure", "figcaption", "strong", "em", "b", "i", "code", "pre", "br", "hr",
}
DROP_TAGS = {
    "script", "style", "iframe", "object", "embed", "form", "input", "button",
    "svg", "math", "video", "audio", "template", "noscript",
}
VOID_TAGS = {"img", "br", "hr", "input", "embed"}


@dataclass
class Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list = field(default_factory=list)


class FragmentParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag.lower(), dict(attrs))
        self.stack[-1].children.append(node)
        if tag.lower() not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag.lower(), dict(attrs)))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag.lower():
                self.stack = self.stack[:index]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def safe_url(value, base, image=False):
    if not value:
        return None
    url = urlsplit(urljoin(base, value.strip()))
    if url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password:
        return None
    if image:
        host = url.hostname.lower()
        if url.scheme != "https" or not (host == "medium.com" or host.endswith(".medium.com")):
            return None
        if host == "medium.com" and url.path.startswith("/_/stat"):
            return None
    return urlunsplit(url)


def readable_text(node):
    if isinstance(node, str):
        return node
    if node.tag in DROP_TAGS or node.tag == "img":
        return ""
    return " ".join(readable_text(child) for child in node.children)


def trim_medium_tail(root):
    meaningful = [child for child in root.children if not isinstance(child, str) or child.strip()]
    if meaningful and isinstance(meaningful[-1], Node):
        last = meaningful[-1]
        text = " ".join(readable_text(last).split()).lower()
        if last.tag == "p" and "was originally published in" in text and "on medium" in text:
            root.children.remove(last)
            meaningful.pop()
            if meaningful and isinstance(meaningful[-1], Node) and meaningful[-1].tag == "hr":
                root.children.remove(meaningful[-1])


def heading_shift(node):
    levels = []

    def visit(current):
        if isinstance(current, str):
            return
        if re.fullmatch(r"h[1-6]", current.tag):
            levels.append(int(current.tag[1]))
        for child in current.children:
            visit(child)

    visit(node)
    return max(0, min(levels) - 2) if levels else 0


def render_node(node, base, shift=0):
    if isinstance(node, str):
        return escape(node, quote=False)
    if node.tag in DROP_TAGS:
        return ""
    children = "".join(render_node(child, base, shift) for child in node.children)
    if node.tag not in ALLOWED_TAGS:
        return children
    if node.tag == "img":
        src = safe_url(node.attrs.get("src"), base, image=True)
        if not src or node.attrs.get("width") == "1" or node.attrs.get("height") == "1":
            return ""
        alt = escape(node.attrs.get("alt") or "", quote=True)
        return f'<img src="{escape(src, quote=True)}" alt="{alt}" loading="lazy" decoding="async">'
    if node.tag == "a":
        href = safe_url(node.attrs.get("href"), base)
        if not href:
            return children
        return f'<a href="{escape(href, quote=True)}" target="_blank" rel="noopener noreferrer">{children}</a>'
    tag = node.tag
    if re.fullmatch(r"h[1-6]", tag):
        tag = f"h{min(4, max(2, int(tag[1]) - shift))}"
    if tag in {"b", "i"}:
        tag = {"b": "strong", "i": "em"}[tag]
    if tag in VOID_TAGS:
        return f"<{tag}>"
    return f"<{tag}>{children}</{tag}>"


def first_image(node, base):
    if isinstance(node, str):
        return None
    if node.tag == "img" and node.attrs.get("width") != "1" and node.attrs.get("height") != "1":
        return safe_url(node.attrs.get("src"), base, image=True)
    for child in node.children:
        image = first_image(child, base)
        if image:
            return image
    return None


def slugify(title):
    text = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:90].strip("-")


def excerpt_from(root):
    text = " ".join(readable_text(root).split())
    if len(text) <= 220:
        return text
    return text[:220].rsplit(" ", 1)[0] + "..."


def parse_item(item, existing, used_slugs):
    title = (item.findtext("title") or "").strip()
    raw_url = (item.findtext("link") or "").strip()
    url = safe_url(raw_url, PUBLICATION_URL)
    if not title or not url or urlsplit(url).hostname != "medium.com":
        return None
    parts = urlsplit(url)
    canonical = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    guid = (item.findtext("guid") or canonical).strip()
    body = item.findtext(CONTENT_NS) or ""
    if not body.strip():
        return None
    parsed = FragmentParser()
    parsed.feed(body)
    parsed.close()
    trim_medium_tail(parsed.root)
    if not " ".join(readable_text(parsed.root).split()):
        return None
    published = parsedate_to_datetime(item.findtext("pubDate")).astimezone(timezone.utc)
    old = existing.get(guid, {})
    slug = old.get("slug") or slugify(title) or "article"
    if slug in used_slugs and used_slugs[slug] != guid:
        suffix = re.sub(r"[^a-z0-9]", "", guid.lower())[-8:]
        slug = f"{slug[:80]}-{suffix}"
    used_slugs[slug] = guid
    metadata = {
        "guid": guid,
        "slug": slug,
        "title": title,
        "author": (item.findtext(CREATOR_NS) or "").strip(),
        "date": published.date().isoformat(),
        "date_label": f"{published.strftime('%B')} {published.day}, {published.year}",
        "url": canonical,
        "image": first_image(parsed.root, canonical),
        "excerpt": excerpt_from(parsed.root),
    }
    shift = heading_shift(parsed.root)
    content = "".join(render_node(child, canonical, shift) for child in parsed.root.children)
    return metadata, content


def home_shell():
    home = (ROOT / "index.html").read_text(encoding="utf-8")
    header = re.search(r'<header class="site-header">.*?</header>', home, re.S)
    footer = re.search(r'<footer class="site-footer">.*?</footer>', home, re.S)
    if not header or not footer:
        raise ValueError("Homepage header/footer not found")
    header = header.group(0)
    for anchor in ("top", "about", "events", "community"):
        destination = "/" if anchor == "top" else f"/#{anchor}"
        header = header.replace(f'href="#{anchor}"', f'href="{destination}"')
    return tuple(fragment.replace('src="assets/', 'src="/assets/') for fragment in (header, footer.group(0)))


def document(title, description, canonical, content, header, footer, image=None, author=None, date=None, local_url=None):
    title_tag = escape(f"{title} | ChiPMA", quote=True)
    description_tag = escape(description, quote=True)
    share_image = image or "https://chipma.org/assets/chipma-hero-enhanced.webp"
    image_meta = f'<meta property="og:image" content="{escape(share_image, quote=True)}">'
    author_meta = f'<meta name="author" content="{escape(author, quote=True)}">' if author else ""
    date_meta = f'<meta property="article:published_time" content="{date}">' if date else ""
    optional_meta = f"    {author_meta}{date_meta}\n" if author_meta or date_meta else ""
    return f'''<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0b74c9">
    <meta name="description" content="{description_tag}">
{optional_meta}    <meta property="og:type" content="{'article' if date else 'website'}">
    <meta property="og:title" content="{title_tag}">
    <meta property="og:description" content="{description_tag}">
    <meta property="og:url" content="{escape(local_url or canonical, quote=True)}">
    {image_meta}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{title_tag}">
    <meta name="twitter:description" content="{description_tag}">
    <meta name="twitter:image" content="{escape(share_image, quote=True)}">
    <link rel="canonical" href="{escape(canonical, quote=True)}">
    <title>{title_tag}</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" sizes="180x180">
    <link rel="stylesheet" href="/styles.css">
    <link rel="stylesheet" href="/blog.css">
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to content</a>
    {header}
    {content}
    {footer}
  </body>
</html>
'''


def article_card(article):
    title = escape(article["title"])
    slug = escape(article["slug"], quote=True)
    author = escape(article["author"])
    excerpt = escape(article["excerpt"])
    image = article.get("image")
    entry_class = "blog-entry" if image else "blog-entry blog-entry--no-image"
    image_link = (f'      <a class="blog-entry-image" href="/blog/{slug}" aria-label="Read {escape(article["title"], quote=True)}">'
                  f'<img src="{escape(image, quote=True)}" alt="" loading="lazy"></a>\n') if image else ""
    return f'''<article class="{entry_class}">
      <div>
        <div class="blog-meta"><time datetime="{article['date']}">{article['date_label']}</time><span>{author}</span></div>
        <h2><a href="/blog/{slug}">{title}</a></h2>
        <p>{excerpt}</p>
      </div>
{image_link}    </article>'''


def render_index(articles, header, footer):
    cards = "\n".join(article_card(article) for article in articles)
    listing = f'<div class="blog-list">{cards}</div>' if articles else (
        f'<div class="blog-empty"><p>Articles are temporarily unavailable.</p>'
        f'<a href="{PUBLICATION_URL}" target="_blank" rel="noopener noreferrer">Visit ChiPMA on Medium</a></div>'
    )
    content = f'''<main class="blog-main" id="main-content">
      <div class="blog-inner">
        <header class="blog-intro"><p class="section-kicker">Blog</p>
          <h1>Ideas from Chicago’s product community.</h1></header>
        {listing}
      </div>
    </main>'''
    return document("Blog", "Ideas from Chicago’s product community.", "https://chipma.org/blog", content, header, footer)


def render_article(article, body, header, footer):
    title = escape(article["title"])
    author = escape(article["author"])
    url = escape(article["url"], quote=True)
    content = f'''<main class="blog-main" id="main-content">
      <article class="article-shell">
        <a class="blog-back" href="/blog">&larr; All articles</a>
        <header class="article-header">
          <p class="section-kicker">Blog</p>
          <h1>{title}</h1>
          <div class="blog-meta"><span>{author}</span><time datetime="{article['date']}">{article['date_label']}</time></div>
          <a class="article-source" href="{url}" target="_blank" rel="noopener noreferrer">Originally published on Medium <span aria-hidden="true">&#8599;</span></a>
        </header>
        <div class="article-body">{body}</div>
      </article>
    </main>'''
    return document(article["title"], article["excerpt"], article["url"], content,
                    header, footer, article.get("image"), article["author"], article["date"],
                    f"https://chipma.org/blog/{article['slug']}")


def write_if_changed(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_text(encoding="utf-8") != content:
        path.write_text(content, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feed-file", type=Path, help="Use a downloaded RSS file for offline generation")
    args = parser.parse_args()
    header, footer = home_shell()
    archive_path = BLOG / "articles.json"
    archive = json.loads(archive_path.read_text(encoding="utf-8")) if archive_path.exists() else []
    existing = {article["guid"]: article for article in archive}
    used_slugs = {article["slug"]: article["guid"] for article in archive}
    try:
        if args.feed_file:
            feed = args.feed_file.read_bytes()
        else:
            request = Request(FEED_URL, headers={"User-Agent": "ChiPMA website feed reader (+https://chipma.org)"})
            with urlopen(request, timeout=25) as response:
                feed = response.read(2_000_001)
        if len(feed) > 2_000_000:
            raise ValueError("RSS feed exceeds size limit")
        items = ET.fromstring(feed).findall("./channel/item")
        if not items:
            raise ValueError("RSS feed has no items")
    except (OSError, ET.ParseError, ValueError) as exc:
        if archive:
            print(f"RSS unavailable; retaining {len(archive)} cached articles: {exc}", file=sys.stderr)
            return
        write_if_changed(BLOG / "index.html", render_index([], header, footer))
        print(f"RSS unavailable; generated empty state: {exc}", file=sys.stderr)
        return

    updated = 0
    for item in items:
        parsed = parse_item(item, existing, used_slugs)
        if not parsed:
            continue
        article, body = parsed
        existing[article["guid"]] = article
        write_if_changed(BLOG / article["slug"] / "index.html", render_article(article, body, header, footer))
        updated += 1
    articles = sorted(existing.values(), key=lambda article: (article["date"], article["guid"]), reverse=True)
    write_if_changed(archive_path, json.dumps(articles, ensure_ascii=False, indent=2) + "\n")
    write_if_changed(BLOG / "index.html", render_index(articles, header, footer))
    print(f"Processed {updated} feed items; {len(articles)} local articles available")


if __name__ == "__main__":
    main()
