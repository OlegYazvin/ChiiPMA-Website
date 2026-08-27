# Deploy ChiPMA.org with GitHub Pages and Cloudflare

This project is ready to publish as a plain static site. No package installation or build step is required.

## Live Deployment

The site was deployed and fully verified on August 26, 2026:

- **Production site:** <https://chipma.org/>
- **Repository:** <https://github.com/OlegYazvin/ChiiPMA-Website>
- **Publishing source:** `main` branch, repository root
- **Canonical hostname:** `chipma.org`; `www.chipma.org` redirects to the apex domain
- **DNS:** Cloudflare DNS-only records resolve both hostnames to GitHub Pages
- **HTTPS:** Enforced by GitHub Pages with a Let's Encrypt certificate covering `chipma.org` and `www.chipma.org`

Future pushes to `main` deploy automatically through GitHub Pages.

## Before Publishing

1. Open `index.html` in a browser and review the copy, partner list, and outbound links.
2. Replace or add a public contact address when one is available.
3. Review `ORGANIZATION-BRIEF.md`, especially the items under “Content to Confirm Later.”
4. Keep the included `CNAME` file. It tells GitHub Pages that the intended custom domain is `chipma.org`.

## 1. Create the GitHub Repository

Create a new repository on GitHub. A name such as `chipma-website` is clear and works well. Make it public if the GitHub account uses the Free plan.

From this project folder, run:

```sh
git init
git add .
git commit -m "Launch ChiPMA static website"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/chipma-website.git
git push -u origin main
```

Replace `YOUR-USERNAME` with the GitHub account or organization that owns the new repository.

## 2. Turn On GitHub Pages

1. Open the repository on GitHub.
2. Go to **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/(root)` folder, then save.
5. Wait for the Pages deployment to finish. The Actions tab shows its status.
6. Test the temporary URL, normally `https://YOUR-USERNAME.github.io/chipma-website/`.

Publishing directly from `main` is the simplest supported option for this build-free site.

## 3. Verify ChiPMA.org in GitHub

GitHub recommends verifying a custom domain before pointing DNS at a Pages site. This protects the domain from being claimed by another GitHub account.

1. In GitHub, open the owning account's **Settings > Pages**. For an organization, use the organization's settings.
2. Add `chipma.org` as a verified domain.
3. GitHub will display a unique TXT record similar to `_github-pages-challenge-YOUR-USERNAME`.
4. In Cloudflare, open **ChiPMA.org > DNS > Records** and add the TXT record exactly as GitHub provides it.
5. Return to GitHub and complete verification.
6. Keep the TXT record in Cloudflare after verification.

## 4. Add the Custom Domain in the Repository

Before changing the website's DNS records:

1. Go to the repository's **Settings > Pages**.
2. Under **Custom domain**, enter `chipma.org` and save.
3. Confirm that GitHub recognizes the included `CNAME` file.

GitHub specifically recommends adding the domain to the repository before directing DNS to it, which reduces domain-takeover risk.

## 5. Point Cloudflare DNS to GitHub Pages

Before editing anything, export or screenshot the existing Cloudflare DNS records. Do not remove MX, email-related TXT, DKIM, DMARC, or other unrelated service records.

Remove only conflicting web records for `@` or `www`, then add:

| Type | Name | Target | Proxy status |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | DNS only |
| A | `@` | `185.199.109.153` | DNS only |
| A | `@` | `185.199.110.153` | DNS only |
| A | `@` | `185.199.111.153` | DNS only |
| CNAME | `www` | `YOUR-USERNAME.github.io` | DNS only |

The `www` target must not include `/chipma-website` or any other path. If a GitHub organization owns the repository, use `YOUR-ORGANIZATION.github.io` instead.

Start with Cloudflare's proxy set to **DNS only** (gray cloud). This lets GitHub see the expected DNS records directly while it validates the domain and provisions the certificate. Cloudflare can remain the registrar and authoritative DNS provider without proxying web traffic.

## 6. Enable HTTPS and Test

DNS can update quickly but may take up to 24 hours. Check it with:

```sh
dig chipma.org +noall +answer -t A
dig www.chipma.org +noall +answer
```

After GitHub shows a successful DNS check:

1. In **Repository Settings > Pages**, enable **Enforce HTTPS**.
2. Visit `https://chipma.org` and `https://www.chipma.org` in a private browser window.
3. Confirm that one hostname redirects to the other, the certificate is valid, the hero image loads, and the Meetup and LinkedIn links work.
4. Check the response from a terminal if needed:

```sh
curl -I https://chipma.org
curl -I https://www.chipma.org
```

Once GitHub HTTPS is stable, the Cloudflare proxy may be enabled as an optional second layer. GitHub Pages is already a CDN, so leaving these records DNS-only is a simple, reliable default. If the proxy is enabled later and certificate or redirect problems appear, return both web records to DNS-only first.

## 7. Publish Future Updates

Edit the files locally, check the page in a browser, then run:

```sh
git add .
git commit -m "Describe the website update"
git push
```

GitHub Pages will redeploy automatically after each push to `main`.

## Launch Checklist

- [ ] All page copy, leaders, and partners reviewed
- [ ] Public contact method added when available
- [x] Repository created and pushed to `main`
- [x] GitHub Pages publishing from `main` and `/(root)`
- [x] Temporary `github.io` URL tested
- [ ] Domain verified with GitHub TXT record
- [x] `chipma.org` saved in repository Pages settings
- [x] Cloudflare web DNS records added as DNS-only
- [x] `https://chipma.org` loads with a valid certificate
- [x] `https://www.chipma.org` redirects correctly
- [x] Meetup, Instagram, LinkedIn, partner, and footer links tested
- [x] Mobile layout and keyboard navigation checked

## Official References

- [GitHub: Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub: Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GitHub: Verifying a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)
- [Cloudflare: DNS record types](https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/)
- [Cloudflare: Proxy status](https://developers.cloudflare.com/dns/proxy-status/)
