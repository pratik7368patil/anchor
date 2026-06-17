import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docsPages, seoLandingPages, seoPages, siteUrl, socialImageUrl } from "../src/content";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDir, "..");
const distDir = path.join(siteRoot, "dist");
const indexPath = path.join(distDir, "index.html");

if (!fs.existsSync(indexPath)) {
  throw new Error(`Missing built index.html at ${indexPath}. Run vite build first.`);
}

const baseHtml = fs.readFileSync(indexPath, "utf8");
const routes = Object.values(seoPages).sort((a, b) => a.path.localeCompare(b.path));

for (const metadata of routes) {
  const html = injectSeo(baseHtml, metadata.path);
  const outputPath =
    metadata.path === "/"
      ? indexPath
      : path.join(distDir, metadata.path.replace(/^\//, ""), "index.html");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
}

fs.writeFileSync(path.join(distDir, "sitemap.xml"), renderSitemap());

function injectSeo(html: string, routePath: string): string {
  const fallback = renderStaticFallback(routePath);
  const cleanHead = html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+name=["']keywords["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+name=["']robots["'][^>]*>\s*/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>\s*/gi, "")
    .replace(
      /<script\s+id=["']anchor-structured-data["']\s+type=["']application\/ld\+json["']>[\s\S]*?<\/script>\s*/gi,
      "",
    );

  return cleanHead
    .replace("</head>", `${renderSeoHead(routePath)}\n  </head>`)
    .replace('<div id="app"></div>', `<div id="app">${fallback}</div>`);
}

function renderSeoHead(routePath: string): string {
  const metadata = seoPages[routePath] ?? seoPages["/"];
  const canonicalUrl = `${siteUrl}${metadata.path === "/" ? "/" : metadata.path}`;
  const structuredData = JSON.stringify(buildStructuredData(routePath)).replaceAll("<", "\\u003c");

  return `    <title>${escapeHtml(metadata.title)}</title>
    <meta name="description" content="${escapeAttribute(metadata.description)}" />
    <meta name="keywords" content="${escapeAttribute(metadata.keywords.join(", "))}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />
    <meta property="og:title" content="${escapeAttribute(metadata.title)}" />
    <meta property="og:description" content="${escapeAttribute(metadata.description)}" />
    <meta property="og:type" content="${metadata.ogType ?? "website"}" />
    <meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />
    <meta property="og:image" content="${escapeAttribute(socialImageUrl)}" />
    <meta property="og:site_name" content="Anchor" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttribute(metadata.title)}" />
    <meta name="twitter:description" content="${escapeAttribute(metadata.description)}" />
    <meta name="twitter:image" content="${escapeAttribute(socialImageUrl)}" />
    <script id="anchor-structured-data" type="application/ld+json">${structuredData}</script>`;
}

function renderStaticFallback(routePath: string): string {
  const metadata = seoPages[routePath] ?? seoPages["/"];
  const landing = seoLandingPages.find((page) => page.path === routePath);
  const docsPage = docsPages.find((page) => page.path === routePath);
  const command = landing?.command
    ? `<pre><code>${escapeHtml(landing.command)}</code></pre>`
    : `<pre><code>npx @pratik7368patil/anchor demo</code></pre>`;
  const bullets = landing?.howAnchorHelps ?? [
    "Indexes merged GitHub PR history and current local code.",
    "Returns concise MCP context for AI coding agents before edits.",
    "Keeps indexes local, sanitized, read-only, and evidence-backed.",
  ];

  return `<main class="seo-static-fallback">
      <h1>${escapeHtml(metadata.title)}</h1>
      <p>${escapeHtml(landing?.description ?? docsPage?.description ?? metadata.description)}</p>
      ${landing ? `<p>${escapeHtml(landing.problem)}</p>` : ""}
      <ul>${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ${command}
      <p><a href="${escapeAttribute(siteUrl)}">Anchor docs</a> · <a href="https://github.com/pratik7368patil/anchor">GitHub</a></p>
    </main>`;
}

function renderSitemap(): string {
  const urls = routes
    .map((route) => {
      const loc = `${siteUrl}${route.path === "/" ? "/" : route.path}`;
      return `  <url>
    <loc>${escapeHtml(loc)}</loc>
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildStructuredData(routePath: string): Record<string, unknown> {
  const metadata = seoPages[routePath] ?? seoPages["/"];
  const canonicalUrl = `${siteUrl}${metadata.path === "/" ? "/" : metadata.path}`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "Anchor",
        url: siteUrl,
        description: seoPages["/"].description,
      },
      {
        "@type": "SoftwareApplication",
        name: "Anchor",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Linux, Windows",
        url: siteUrl,
        codeRepository: "https://github.com/pratik7368patil/anchor",
        description:
          "Local-first MCP server for AI coding agents, GitHub PR history, codebase indexing, tests, regressions, and org memory.",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      },
      {
        "@type": metadata.ogType === "article" ? "TechArticle" : "WebPage",
        name: metadata.title,
        headline: metadata.title,
        description: metadata.description,
        url: canonicalUrl,
        image: socialImageUrl,
        isPartOf: {
          "@type": "WebSite",
          name: "Anchor",
          url: siteUrl,
        },
      },
    ],
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("\n", " ");
}
