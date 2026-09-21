# ChiPMA blog feed

`/blog` and its article pages are static HTML generated from the official
[ChiPMA Medium RSS feed](https://medium.com/feed/chicago-product-management-association).
The feed is the publishing source. Run `python3 scripts/update_blog.py` to
refresh locally, or pass `--feed-file path/to/feed.xml` to work offline.

GitHub Pages has no request-time server or direct browser access to this feed.
The scheduled GitHub Actions workflow checks Medium at 7, 22, 37, and 52 minutes
past each hour. It commits the last successful generated pages and deploys the
same snapshot to Pages. A new article should normally appear after the next
successful run and Pages deployment; GitHub's scheduler or Pages deployment may
add delay beyond 15 minutes. If Medium is unavailable, the generator retains
the last committed pages. Previously seen articles remain in the local archive
when they leave Medium's recent RSS window.

The current Pages publishing source is the repository's `main` branch. The
workflow uses an explicit Pages artifact deployment because commits made with
`GITHUB_TOKEN` do not themselves trigger a branch-source Pages build. This
workflow runs only from the default branch after it is merged; it does not
deploy from a local checkout or review branch.

`content:encoded` supplies the article body. The generator parses it and emits
only presentation-safe tags and HTTPS Medium images. It removes scripts,
embeds, executable attributes, unsafe URLs, Medium's tracking pixel, and RSS
publication boilerplate. The generated article's canonical URL points to the
original Medium post. Images without author-provided alt text retain empty alt
text rather than guessed descriptions.

The sitemap lists only ChiPMA's own canonical pages (home and Blog index).
Individual article pages are discoverable from the index but canonical to
their Medium originals.
