import {
  commandDetails,
  commandGroups,
  docsPages,
  features,
  installCommand,
  mcpTools,
  repoUrl,
  useCases,
  workflowRecipes,
  workflowCommand,
  type CommandOption,
  type TableItem,
} from "./content";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");
const legacyDocsHashes: Record<string, string> = {
  "#docs": "/docs",
  "#quickstart": "/docs/quickstart",
  "#workflows": "/docs/workflows",
  "#planning": "/docs/planning",
  "#architecture": "/docs/architecture",
  "#onboarding": "/docs/onboarding",
  "#ci": "/docs/ci",
  "#playbooks": "/docs/playbooks",
  "#org-memory": "/docs/org-memory",
  "#commands": "/docs/cli",
  "#options": "/docs/cli",
  "#mcp": "/docs/mcp",
  "#rules": "/docs/rules",
  "#features": "/docs/features",
  "#use-cases": "/docs/use-cases",
};

if (!app) {
  throw new Error("Missing #app root");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizePath(pathname: string): string {
  if (pathname !== "/" && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function renderShell(content: string, activeArea: "home" | "docs"): string {
  const productHref = activeArea === "home" ? "#product" : "/";
  const whyHref = activeArea === "home" ? "#why" : "/#why";
  const privacyHref = activeArea === "home" ? "#privacy" : "/docs/privacy";
  const headerNav =
    activeArea === "home"
      ? `<div class="nav-links" id="nav-links">
          <a href="${productHref}">Product</a>
          <a href="${whyHref}">Why Anchor</a>
          <a href="/docs" data-route>Docs</a>
          <a href="/docs/cli" data-route>CLI</a>
          <a href="${privacyHref}" data-route>Privacy</a>
        </div>`
      : "";
  const headerActions =
    activeArea === "home"
      ? `<div class="header-actions">
          <a class="btn" href="/docs" data-route>Docs</a>
          <a class="btn primary" href="${repoUrl}#readme">Install</a>
          <button class="mobile-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="nav-links">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>`
      : "";

  const header =
    activeArea === "home"
      ? `<header class="site-header">
          <nav class="nav" aria-label="Primary navigation">
            <a class="brand" href="/" data-route aria-label="Anchor home">
              <span class="brand-mark" aria-hidden="true">${renderAnchorIcon()}</span>
              Anchor
            </a>
            ${headerNav}
            ${headerActions}
          </nav>
        </header>`
      : "";

  return `
    ${header}

    ${content}

    <footer class="footer">
      <span>Anchor / local-first context for Cursor Agent</span>
      <span>No SaaS. No telemetry. No write access to GitHub.</span>
    </footer>
  `;
}

function renderHome(): string {
  return renderShell(
    `
      <main id="top">
        <section class="section hero" id="product" aria-labelledby="hero-title">
          <div class="hero-copy fade-up">
            <h1 id="hero-title">Give Cursor the repo memory your team already earned.</h1>
            <p>Anchor indexes merged GitHub PR history and local code on your machine, then gives Cursor Agent the constraints, regressions, tests, and team rules it should know before editing code.</p>
            <div class="hero-actions">
              <a class="btn primary" href="/docs/quickstart" data-route>
                Start with the docs
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h13m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
              </a>
              <a class="btn" href="${repoUrl}">View GitHub</a>
            </div>
            <div class="hero-proof" aria-label="Anchor guarantees">
              <div class="proof-chip">
                <strong>Local-first context</strong>
                <span>History and code evidence stay in a repo-local SQLite index.</span>
              </div>
              <div class="proof-chip">
                <strong>Cursor-only MCP</strong>
                <span>Built to brief Cursor Agent before non-trivial edits.</span>
              </div>
              <div class="proof-chip">
                <strong>Evidence, not vibes</strong>
                <span>Context cites PRs, review comments, files, tests, and rules.</span>
              </div>
            </div>
          </div>

          <div class="hero-visual fade-up" aria-label="Anchor local workflow product mockup">
            ${renderProductMockup()}
          </div>
        </section>

        <section class="section trust fade-up" aria-label="Trust points">
          <div class="trust-point"><span aria-hidden="true"></span><strong>Local SQLite index</strong></div>
          <div class="trust-point"><span aria-hidden="true"></span><strong>No SaaS</strong></div>
          <div class="trust-point"><span aria-hidden="true"></span><strong>No telemetry</strong></div>
          <div class="trust-point"><span aria-hidden="true"></span><strong>No LLM API calls</strong></div>
          <div class="trust-point"><span aria-hidden="true"></span><strong>Read-only GitHub access</strong></div>
        </section>

        <section class="section split-section" id="why" aria-labelledby="missing-layer-title">
          <div class="fade-up">
            <span class="section-label">01 / The missing layer</span>
            <h2 id="missing-layer-title">Agents see the file. They miss the review history.</h2>
            <p class="section-intro">Repository history is where teams record why code is shaped a certain way. Anchor turns that context into a local briefing Cursor can use before it changes the next file.</p>
          </div>
          <div class="memory-list fade-up">
            <div class="memory-row">
              <span class="mark">why</span>
              <div><strong>Why a file is shaped a certain way</strong><span>Architecture choices often live in merged PRs, review threads, and old commit messages.</span></div>
            </div>
            <div class="memory-row">
              <span class="mark">bug</span>
              <div><strong>What broke last time</strong><span>Regressions and rollback notes become visible before similar edits repeat them.</span></div>
            </div>
            <div class="memory-row">
              <span class="mark">api</span>
              <div><strong>Which API contracts matter</strong><span>Compatibility constraints become searchable, cited context for the next diff.</span></div>
            </div>
            <div class="memory-row">
              <span class="mark">test</span>
              <div><strong>Which tests reviewers expect</strong><span>Anchor can surface sibling tests, related files, and review expectations.</span></div>
            </div>
            <div class="memory-row">
              <span class="mark">arch</span>
              <div><strong>Which architecture pattern to follow</strong><span>Architecture Memory summarizes current file areas, imports, symbols, and nearby tests from local code.</span></div>
            </div>
          </div>
        </section>

        <section class="section split-section compact-section" id="privacy" aria-labelledby="privacy-title">
          <div class="fade-up">
            <span class="section-label">02 / Local by default</span>
            <h2 id="privacy-title">Built for maintainers who do not want another hosted surface.</h2>
            <p class="section-intro">Anchor keeps the index on your machine, treats PR text as evidence rather than instructions, and avoids write paths to GitHub entirely.</p>
          </div>
          <div class="memory-list fade-up">
            <div class="memory-row">
              <span class="mark">db</span>
              <div><strong>SQLite in the repo</strong><span>The local index lives at <code>.anchor/index.sqlite</code>.</span></div>
            </div>
            <div class="memory-row">
              <span class="mark">ro</span>
              <div><strong>Read-only GitHub access</strong><span>Anchor indexes merged PR history and returns context. It never writes to GitHub.</span></div>
            </div>
            <div class="memory-row">
              <span class="mark">sec</span>
              <div><strong>Sanitized evidence</strong><span>Secrets and prompt-injection phrases are redacted before Cursor sees them.</span></div>
            </div>
          </div>
        </section>

        <section class="section final-cta" aria-labelledby="final-title">
          <div class="final-panel fade-up">
            <h2 id="final-title">Docs that follow the workflow, not the marketing page.</h2>
            <p>Use the separate docs route for install steps, guide pages, CLI reference, MCP tools, rules, and safety notes.</p>
            <div class="final-actions">
              <a class="btn primary" href="/docs" data-route>Open docs</a>
              <a class="btn" href="/docs/cli" data-route>CLI reference</a>
            </div>
          </div>
        </section>
      </main>
    `,
    "home",
  );
}

function renderDocsRoute(pathname: string): string {
  const path = normalizePath(pathname) === "/docs/options" ? "/docs/cli" : normalizePath(pathname);
  const page = docsPages.find((item) => item.path === path) ?? docsPages[0];
  const content = page ? renderDocsPageContent(page.path) : renderDocsPageContent("/docs");

  return renderShell(
    `
      <main class="docs-page" id="top">
        <section class="section docs-shell">
          ${renderDocsSidebar(page?.path ?? "/docs")}
          <div class="docs-content">
            <div class="docs-page-actions">
              <button class="copy-page-btn" type="button" data-copy-page>
                ${renderCopyIcon()}
                <span>Copy page</span>
              </button>
            </div>
            ${content}
          </div>
        </section>
      </main>
    `,
    "docs",
  );
}

function renderDocsSidebar(activePath: string): string {
  return `<aside class="docs-sidebar fade-up" aria-label="Docs navigation">
    <a class="docs-brand" href="/" data-route aria-label="Anchor home">
      <span class="brand-mark" aria-hidden="true">${renderAnchorIcon()}</span>
      <span>
        <strong>Anchor</strong>
        <small>Repo memory for Cursor</small>
      </span>
    </a>

    <nav class="docs-drawer-list" aria-label="Documentation pages">
      ${docsPages
        .map(
          (
            page,
          ) => `<a class="docs-drawer-link ${page.path === activePath ? "is-active" : ""}" href="${page.path}" data-route>
            <span class="docs-link-icon" aria-hidden="true">${renderDocIcon(page.path)}</span>
            <span>${page.title}</span>
          </a>`,
        )
        .join("")}
    </nav>

    <div class="docs-drawer-secondary" aria-label="Site links">
      <a href="/" data-route>Product home</a>
      <a href="/#why" data-route>Why Anchor</a>
      <a href="${repoUrl}">GitHub</a>
      <a href="${repoUrl}#readme">Install</a>
    </div>
  </aside>`;
}

function renderDocsPageContent(path: string): string {
  switch (path) {
    case "/docs/quickstart":
      return renderQuickstartPage();
    case "/docs/workflows":
      return renderWorkflowsPage();
    case "/docs/planning":
      return renderPlanningPage();
    case "/docs/architecture":
      return renderArchitecturePage();
    case "/docs/onboarding":
      return renderOnboardingPage();
    case "/docs/ci":
      return renderCiPage();
    case "/docs/playbooks":
      return renderPlaybooksPage();
    case "/docs/org-memory":
      return renderOrgMemoryPage();
    case "/docs/rules":
      return renderRulesPage();
    case "/docs/cli":
      return renderCliPage();
    case "/docs/mcp":
      return renderMcpPage();
    case "/docs/privacy":
      return renderPrivacyPage();
    case "/docs/features":
      return renderFeaturesPage();
    case "/docs/use-cases":
      return renderUseCasesPage();
    default:
      return renderDocsOverview();
  }
}

function renderDocsOverview(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Get Started</span>
      <h2>Introduction</h2>
      <p class="section-intro">Anchor gives Cursor Agent the repository memory your team has already earned: merged PR history, code context, tests, regressions, and team-approved rules.</p>
      <div class="doc-divider"></div>
      <p class="doc-prose">It is built for maintainers who want AI edits grounded in local evidence instead of guesses. Anchor indexes repository history into SQLite, exposes that memory through a narrow Cursor MCP server, and returns cited context before risky edits.</p>
      <p class="doc-prose">Start with installation, then use the workflow and reference pages when you need exact commands, MCP tool names, or team rule behavior.</p>
      <h3>Which command should I run?</h3>
      ${renderWorkflowRecipes()}
      <h3>Recommended team rollout</h3>
      ${renderCodeBlock(
        "Rollout commands",
        "rollout-code",
        `anchor demo
anchor init
anchor index --limit 200
anchor index-code
anchor health
anchor eval init
anchor rules suggest
anchor ci
anchor org init --org my-org
anchor org add-repo my-org/backend-api --group backend
anchor org sync --org my-org`,
        true,
      )}
      <div class="doc-callout">
        <span aria-hidden="true">${renderDocIcon("/docs")}</span>
        <p>Anchor does not need a hosted dashboard. The product surface that matters is the context Cursor receives before it edits.</p>
      </div>
      <h3>Docs map</h3>
      <div class="docs-index-grid">
        ${docsPages
          .filter((page) => page.path !== "/docs")
          .map(
            (page) => `<a class="mini-link-card" href="${page.path}" data-route>
              <span>${page.group}</span>
              <strong>${page.title}</strong>
              <p>${page.description}</p>
            </a>`,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderQuickstartPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Get Started</span>
      <h2>Installation</h2>
      <p class="section-intro">Use this path when you are inside a GitHub-backed repo and want Anchor available to Cursor immediately.</p>
      ${renderCodeBlock("Install and initialize", "install-code", installCommand)}
      <div class="quick-grid" aria-label="Quickstart checkpoints">
        <div>
          <span>01</span>
          <strong>Configure Cursor</strong>
          <p><code>anchor init</code> safely merges the MCP entry and writes the Cursor rule.</p>
        </div>
        <div>
          <span>02</span>
          <strong>Build memory</strong>
          <p><code>anchor index</code> indexes merged PRs and local code into SQLite.</p>
        </div>
        <div>
          <span>03</span>
          <strong>Check setup</strong>
          <p><code>anchor doctor</code> catches auth, config, database, and MCP issues.</p>
        </div>
      </div>
    </article>
  `;
}

function renderWorkflowsPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Guide</span>
      <h2>Workflows</h2>
      <p class="section-intro">Use the right Anchor surface depending on whether you are preparing a change, explaining a file, reviewing a diff, or sharing context with the team.</p>
      <div class="workflow-grid">
        <div>
          <strong>Plan the task</strong>
          <p>Run <code>anchor plan "&lt;task&gt;"</code> or ask Cursor for <code>anchor_plan_task</code> before the first edit.</p>
        </div>
        <div>
          <strong>Know exact checks</strong>
          <p>Run <code>anchor test-command &lt;file&gt;</code> so the agent has a concrete verification command.</p>
        </div>
        <div>
          <strong>Before editing</strong>
          <p>Ask Cursor to call <code>anchor_get_context</code> before refactors, API changes, or security-sensitive work.</p>
        </div>
        <div>
          <strong>Risky changes</strong>
          <p>Use <code>strict: true</code> with <code>minConfidence: "moderate"</code> so weak, stale, or loose matches do not steer the agent.</p>
        </div>
        <div>
          <strong>Explain a file</strong>
          <p>Run <code>anchor explain &lt;file&gt;</code> to onboard yourself before touching a confusing area.</p>
        </div>
        <div>
          <strong>Review a diff</strong>
          <p>Run <code>anchor review</code> before opening a PR to catch known regressions and missing checks.</p>
        </div>
        <div>
          <strong>Check architecture</strong>
          <p>Run <code>anchor architecture --check</code> before large changes to compare the diff against local placement, import, and test patterns.</p>
        </div>
        <div>
          <strong>Check cross-repo impact</strong>
          <p>Run <code>anchor org impact</code> or ask Cursor for <code>anchor_check_cross_repo_impact</code> before access, API, SDK, schema, or shared-package changes.</p>
        </div>
        <div>
          <strong>Onboard to an area</strong>
          <p>Use <code>anchor onboarding --area api</code> to summarize areas, risky modules, tests, and starter prompts.</p>
        </div>
        <div>
          <strong>Gate reliability</strong>
          <p>Use <code>anchor eval run</code> and <code>anchor ci</code> to catch drift, low coverage, stale indexes, and invalid rules.</p>
        </div>
        <div>
          <strong>Share context</strong>
          <p>Add <code>--share</code> when the output should fit in Slack or a PR comment.</p>
        </div>
      </div>
      ${renderCodeBlock("Common workflow commands", "workflow-code", workflowCommand, true)}
      <h3>Quick command picker</h3>
      ${renderWorkflowRecipes()}
    </article>
  `;
}

function renderPlanningPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Guide</span>
      <h2>Planning and tests</h2>
      <p class="section-intro">Anchor can brief Cursor on what to edit, what patterns to follow, and exactly which checks to run before the first code change.</p>
      <div class="workflow-grid">
        <div>
          <strong>Task plans</strong>
          <p><code>anchor plan</code> combines PR evidence, current code, architecture patterns, tests, regressions, and team rules into target files, symbols, steps, risks, and checks.</p>
        </div>
        <div>
          <strong>Exact tests</strong>
          <p><code>anchor test-command</code> reads package scripts, workspace boundaries, Vitest/Jest/Playwright config, and related tests to infer concrete commands.</p>
        </div>
        <div>
          <strong>Cursor tools</strong>
          <p>Use <code>anchor_plan_task</code> before editing and <code>anchor_get_test_commands</code> before verification.</p>
        </div>
        <div>
          <strong>Evidence labels</strong>
          <p>Plans cite PR/rule evidence when available and label current-code inference when history does not exist.</p>
        </div>
      </div>
      ${renderCodeBlock(
        "Planning commands",
        "planning-code",
        `anchor plan "Add resource API integration" --file src/api/resource.ts --symbol createResource
anchor plan "Refactor auth cache" --file src/auth/cache.ts --strict --json
anchor test-command src/services/resource.ts
anchor test-command src/services/resource.test.ts --json`,
        true,
      )}
    </article>
  `;
}

function renderArchitecturePage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Guide</span>
      <h2>Architecture Memory</h2>
      <p class="section-intro">Architecture Memory helps Cursor follow the repo's current shape before it writes code. It is deterministic, local-only, and built from the sanitized local code index.</p>
      <div class="workflow-grid">
        <div>
          <strong>File areas</strong>
          <p>Anchor classifies files as <code>api</code>, <code>service</code>, <code>component</code>, <code>hook</code>, <code>route</code>, <code>store</code>, <code>test</code>, <code>schema</code>, <code>type</code>, <code>config</code>, <code>util</code>, or <code>unknown</code>.</p>
        </div>
        <div>
          <strong>Import direction</strong>
          <p>It extracts local import edges so new code can follow existing layer direction instead of guessing where dependencies should point.</p>
        </div>
        <div>
          <strong>Pattern evidence</strong>
          <p>It ranks repeated folder placement, exported symbols, nearby tests, and matching files. Recommendations cite indexed files, with PR and rule evidence available through <code>anchor_get_context</code>.</p>
        </div>
        <div>
          <strong>Diff checks</strong>
          <p><code>anchor architecture --check</code> reads the current git diff, or <code>--diff-file</code>, and returns architecture risks plus recommended checks.</p>
        </div>
      </div>
      ${renderCodeBlock(
        "Architecture commands",
        "architecture-code",
        `anchor index-code
anchor architecture
anchor architecture --file src/auth/cache.ts
anchor architecture --area api
anchor architecture --map --format mermaid
anchor architecture --map --format json
anchor architecture --check
anchor architecture --diff-file change.diff --check
anchor architecture --write-doc`,
        true,
      )}
      <div class="doc-callout">
        <span aria-hidden="true">${renderDocIcon("/docs/architecture")}</span>
        <p><code>--write-doc</code> is the only architecture command that writes a file. It creates <code>ANCHOR_ARCHITECTURE.md</code> from local evidence when you explicitly request it.</p>
      </div>
    </article>
  `;
}

function renderOnboardingPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Guide</span>
      <h2>Onboarding packs</h2>
      <p class="section-intro">Onboarding packs compress current architecture, important files, risky modules, likely tests, team rules, playbooks, and starter prompts into one local brief.</p>
      <div class="workflow-grid">
        <div>
          <strong>Repo brief</strong>
          <p><code>anchor onboarding</code> summarizes the indexed repository areas and useful starting points.</p>
        </div>
        <div>
          <strong>Area brief</strong>
          <p><code>anchor onboarding --area api</code> focuses on one architecture area for feature work.</p>
        </div>
        <div>
          <strong>File brief</strong>
          <p><code>anchor onboarding --file src/auth/cache.ts</code> gives a narrow view for one file.</p>
        </div>
        <div>
          <strong>Cursor handoff</strong>
          <p><code>anchor_onboarding_pack</code> lets Cursor orient itself before a large refactor or unfamiliar task.</p>
        </div>
      </div>
      ${renderCodeBlock(
        "Onboarding commands",
        "onboarding-code",
        `anchor onboarding
anchor onboarding --area api
anchor onboarding --file src/auth/cache.ts --json`,
        true,
      )}
    </article>
  `;
}

function renderCiPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Guide</span>
      <h2>CI and evals</h2>
      <p class="section-intro">Use evals and CI checks when your team wants Anchor context to stay trustworthy as the repository changes.</p>
      <div class="workflow-grid">
        <div>
          <strong>Golden retrieval</strong>
          <p><code>anchor eval add</code> records tasks that should surface known PRs or categories.</p>
        </div>
        <div>
          <strong>Drift detection</strong>
          <p><code>anchor eval run</code> reports missing PR evidence and ranking drift.</p>
        </div>
        <div>
          <strong>CI gate</strong>
          <p><code>anchor ci</code> validates rules, rule evidence, evals, stale code index, and coverage score.</p>
        </div>
        <div>
          <strong>Fresh context</strong>
          <p><code>anchor watch</code> keeps code, architecture, test links, and test commands fresh while developers work.</p>
        </div>
      </div>
      ${renderCodeBlock(
        "Reliability commands",
        "ci-code",
        `anchor eval init
anchor eval add --task "auth cache lazy loading" --file src/auth/cache.ts --expect-pr 101
anchor eval run
anchor ci --strict --min-coverage 70
anchor watch --interval 30`,
        true,
      )}
      ${renderCodeBlock(
        "GitHub Actions snippet",
        "ci-actions-code",
        `name: Anchor CI

on:
  pull_request:

jobs:
  anchor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.33.2
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @pratik7368patil/anchor build
      - run: pnpm --filter @pratik7368patil/anchor start -- index-code
      - run: pnpm --filter @pratik7368patil/anchor start -- ci --strict --min-coverage 70`,
        true,
      )}
      <div class="doc-callout">
        <span aria-hidden="true">${renderDocIcon("/docs/ci")}</span>
        <p>Anchor documents CI usage but does not enable a workflow automatically. Add it only when your team wants Anchor as a repository quality gate.</p>
      </div>
    </article>
  `;
}

function renderPlaybooksPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Guide</span>
      <h2>Playbooks</h2>
      <p class="section-intro">Repo playbooks turn repeated evidence into reviewed workflow briefs for common changes. They are evidence, not executable instructions.</p>
      <div class="workflow-grid">
        <div>
          <strong>Initialize</strong>
          <p><code>anchor playbooks init</code> creates <code>anchor.playbooks.json</code> as the committed source of truth.</p>
        </div>
        <div>
          <strong>Suggest</strong>
          <p><code>anchor playbooks suggest</code> reads local PR/rule evidence and proposes drafts without writing the file.</p>
        </div>
        <div>
          <strong>Use</strong>
          <p><code>anchor playbooks get &lt;id&gt;</code> or <code>anchor_get_playbook</code> retrieves a cited workflow brief.</p>
        </div>
        <div>
          <strong>Examples</strong>
          <p>Good playbooks cover adding API integrations, writing service tests, changing API contracts, or refactoring shared utilities.</p>
        </div>
      </div>
      ${renderCodeBlock(
        "Playbook commands",
        "playbooks-code",
        `anchor playbooks init
anchor playbooks suggest
anchor playbooks list
anchor playbooks get add-api-integration`,
        true,
      )}
    </article>
  `;
}

function renderOrgMemoryPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Guide</span>
      <h2>Org Memory</h2>
      <p class="section-intro">Org Memory lets teams explicitly allowlist repos, clone them into a local managed cache, and build one SQLite-backed view of cross-repo code, PR evidence, API consumers, and impact risk.</p>
      <div class="workflow-grid">
        <div>
          <strong>Explicit allowlist</strong>
          <p><code>anchor org add-repo</code> adds only the repos you choose. Anchor never scans every org repo automatically.</p>
        </div>
        <div>
          <strong>Local cache</strong>
          <p>Managed shallow clones and <code>org.sqlite</code> live under <code>~/.anchor/orgs/&lt;org&gt;</code>.</p>
        </div>
        <div>
          <strong>Cross-repo graph</strong>
          <p>Anchor links package dependencies, imports, API strings, schemas, SDK-like clients, tests, and PR evidence.</p>
        </div>
        <div>
          <strong>Impact checks</strong>
          <p><code>anchor org impact</code> flags access, API contract, shared package, missing-test, stale-index, and regression risks.</p>
        </div>
      </div>
      ${renderCodeBlock(
        "Org rollout",
        "org-memory-code",
        `anchor org init --org my-org
anchor org add-repo my-org/backend-api --group backend
anchor org add-repo my-org/frontend-app --group frontend
anchor org add-repo my-org/shared-sdk --group shared
anchor org sync --org my-org
anchor org status --org my-org
anchor org impact --org my-org --repo my-org/backend-api --strict`,
        true,
      )}
      <div class="doc-callout">
        <span aria-hidden="true">${renderDocIcon("/docs/org-memory")}</span>
        <p>For auth, access, billing, API contracts, schemas, SDK clients, shared packages, or broad refactors, ask Cursor to call <code>anchor_check_cross_repo_impact</code> before editing or approving.</p>
      </div>
    </article>
  `;
}

function renderRulesPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Guide</span>
      <h2>Configuration</h2>
      <p class="section-intro">Anchor rules keep tribal knowledge explicit. A rule should be backed by local PR evidence, validated, and checked against the index before the team depends on it.</p>
      <div class="rules-flow">
        <div><span>1</span><strong>Suggest</strong><p><code>anchor rules suggest</code> finds repeated or high-confidence evidence.</p></div>
        <div><span>2</span><strong>Add</strong><p><code>anchor rules add</code> records the rule with required PR citations.</p></div>
        <div><span>3</span><strong>Validate</strong><p><code>anchor rules validate</code> and <code>check-evidence</code> keep the file honest.</p></div>
      </div>
    </article>
  `;
}

function renderCliPage(): string {
  return `
    <article class="doc-card fade-up">
      <div class="doc-card-head">
        <div>
          <span class="section-label">Reference</span>
          <h2>CLI reference</h2>
          <p class="section-intro">Options are documented next to the command that supports them, because the same flag can mean different tradeoffs depending on the workflow.</p>
        </div>
        <label class="command-search">
          <span class="sr-only">Filter commands</span>
          <input id="command-filter" type="search" placeholder="Filter commands..." autocomplete="off" />
        </label>
      </div>
      <div class="command-groups">${renderCommandGroups()}</div>
    </article>
  `;
}

function renderMcpPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Reference</span>
      <h2>Cursor MCP</h2>
      <p class="section-intro">These are the surfaces Cursor uses to fetch repo memory, explain files, review diffs, and inspect index health.</p>
      ${renderTable(mcpTools, "Anchor MCP tools")}
      ${renderCodeBlock(
        "Main tool input",
        "mcp-input",
        `{
  "task": "Refactor auth cache loading",
  "files": ["src/auth/cache.ts"],
  "symbols": ["AuthCache"],
  "maxResults": 8,
  "strict": true,
  "minConfidence": "moderate"
}`,
        true,
      )}
    </article>
  `;
}

function renderPrivacyPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Safety</span>
      <h2>Privacy and safety</h2>
      <p class="section-intro">Built for maintainers who do not want another hosted surface.</p>
      <div class="safety-card">
        <div class="safety-row">
          <span class="safety-icon" aria-hidden="true">${renderKeyIcon()}</span>
          <div><strong>GitHub auth stays local</strong><span>Anchor reads the token from local GitHub auth or environment. It is never written to Cursor config, SQLite, logs, or generated files.</span></div>
        </div>
        <div class="safety-row">
          <span class="safety-icon" aria-hidden="true">${renderDatabaseIcon()}</span>
          <div><strong>The index stays on your machine</strong><span>.anchor/index.sqlite lives inside the repo. Anchor has no SaaS account, hosted dashboard, telemetry stream, or LLM API path.</span></div>
        </div>
        <div class="safety-row">
          <span class="safety-icon" aria-hidden="true">${renderShieldIcon()}</span>
          <div><strong>PR text is untrusted evidence</strong><span>Secrets and prompt-injection phrases are sanitized or redacted before they can become context for Cursor.</span></div>
        </div>
        <div class="safety-row">
          <span class="safety-icon" aria-hidden="true">${renderShieldIcon()}</span>
          <div><strong>Reliability gate</strong><span>Strict mode filters stale, weak, or loose text-only historical matches and returns a clear no reliable evidence message when nothing passes.</span></div>
        </div>
        <div class="safety-row">
          <span class="safety-icon" aria-hidden="true">${renderReadOnlyIcon()}</span>
          <div><strong>Read-only by design</strong><span>Anchor indexes merged PR history and returns context. It never writes to GitHub.</span></div>
        </div>
      </div>
    </article>
  `;
}

function renderFeaturesPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Reference</span>
      <h2>Features</h2>
      <ul class="feature-list">${renderList(features)}</ul>
    </article>
  `;
}

function renderUseCasesPage(): string {
  return `
    <article class="doc-card fade-up">
      <span class="section-label">Guide</span>
      <h2>Use cases</h2>
      <ul class="use-case-list">${renderList(useCases)}</ul>
    </article>
  `;
}

function renderProductMockup(): string {
  return `
    <div class="mock-window">
      <div class="mock-titlebar">
        <div class="traffic" aria-hidden="true"><span></span><span></span><span></span></div>
        <span>local repo / Anchor MCP</span>
        <span>.anchor/index.sqlite</span>
      </div>
      <div class="mock-grid">
        <div class="mock-panel">
          <div class="panel-head">
            <span>Merged PR history</span>
            <code>read-only</code>
          </div>
          <div class="pr-list">
            <div class="pr-row">
              <strong>PR #42 / Preserve API contract</strong>
              <span>review_comment / src/api/routes.ts</span>
            </div>
            <div class="pr-row">
              <strong>PR #58 / Cache stale-read regression</strong>
              <span>review_summary / src/cache/store.ts</span>
            </div>
            <div class="pr-row">
              <strong>PR #61 / Test sibling overloads</strong>
              <span>changed_files / tests/api/*.spec.ts</span>
            </div>
            <div class="pr-row">
              <strong>Architecture Memory</strong>
              <span>local imports / symbols / file areas</span>
            </div>
            <div class="pr-row">
              <strong>anchor.rules.json</strong>
              <span>team-approved rule / cited evidence</span>
            </div>
          </div>
        </div>

        <div class="mock-panel">
          <div class="panel-head">
            <span>Local index</span>
            <code>SQLite + FTS</code>
          </div>
          <div class="index-core" aria-hidden="true">
            <div class="db-cylinder">
              <span class="wall"></span>
              <b>.anchor<br />index.sqlite</b>
            </div>
          </div>
          <div class="cursor-call">
            <div><span class="cmd">cursor</span> -&gt; mcp.call</div>
            <div>{ name: <span class="cmd">"anchor_get_context"</span>, file: "src/api/routes.ts" }</div>
          </div>
        </div>

        <div class="mock-panel">
          <div class="panel-head">
            <span>Must know</span>
            <code>cited context</code>
          </div>
          <div class="context-panel">
            <div class="context-card">
              <h3>Before editing routes.ts</h3>
              <div class="evidence-item">
                <span class="tag">api_contract</span>
                <p>Preserve backward compatibility for this endpoint.</p>
                <small>Evidence: PR #42 / review_comment / src/api/routes.ts</small>
              </div>
              <div class="evidence-item">
                <span class="tag">bug_regression</span>
                <p>Similar cache changes caused stale reads before.</p>
                <small>Evidence: PR #58 / review_summary / src/cache/store.ts</small>
              </div>
              <div class="evidence-item">
                <span class="tag">recommended_checks</span>
                <p>Run sibling tests and check team rules before the diff.</p>
                <small>Evidence stays local. PR text is untrusted evidence.</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAnchorIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none">
    <path d="M12 4v13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
    <path d="M8 8h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
    <path d="M6 14c1.2 3.2 3.1 5 6 5s4.8-1.8 6-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
  </svg>`;
}

function renderCopyIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="8" y="7" width="10" height="13" rx="2" stroke="currentColor" stroke-width="1.7"></rect>
    <path d="M6 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
  </svg>`;
}

function renderDocIcon(path: string): string {
  const icons: Record<string, string> = {
    "/docs": `<circle cx="12" cy="12" r="9"></circle><path d="M12 10v6"></path><path d="M12 7.2v.1"></path>`,
    "/docs/quickstart": `<path d="m8 5 10 7-10 7V5Z"></path>`,
    "/docs/workflows": `<path d="M4 7h6v6H4z"></path><path d="M14 11h6v6h-6z"></path><path d="M10 10h4"></path>`,
    "/docs/planning": `<path d="M5 6h14"></path><path d="M5 12h9"></path><path d="M5 18h6"></path><path d="m15 18 2 2 4-5"></path>`,
    "/docs/architecture": `<path d="M4 18h16"></path><path d="M7 18V9l5-4 5 4v9"></path><path d="M10 18v-6h4v6"></path>`,
    "/docs/onboarding": `<path d="M7 7h10"></path><path d="M7 12h10"></path><path d="M7 17h6"></path><rect x="4" y="4" width="16" height="16" rx="2"></rect>`,
    "/docs/ci": `<path d="M6 12h4l2-6 3 12 2-6h1"></path><path d="M4 20h16"></path>`,
    "/docs/playbooks": `<path d="M6 4h9l3 3v13H6z"></path><path d="M15 4v4h4"></path><path d="M9 12h6"></path><path d="M9 16h6"></path>`,
    "/docs/org-memory": `<path d="M4 7h6v6H4z"></path><path d="M14 4h6v6h-6z"></path><path d="M14 14h6v6h-6z"></path><path d="M10 10h4"></path><path d="M10 13l4 4"></path>`,
    "/docs/rules": `<path d="M12 3v3"></path><path d="M12 18v3"></path><path d="m4.8 6.5 2.1 2.1"></path><path d="m17.1 15.4 2.1 2.1"></path><circle cx="12" cy="12" r="4"></circle>`,
    "/docs/cli": `<path d="M5 7h14"></path><path d="M7 12h4"></path><path d="M7 17h10"></path><rect x="4" y="4" width="16" height="16" rx="2"></rect>`,
    "/docs/mcp": `<path d="M7 8h10v8H7z"></path><path d="M12 4v4"></path><path d="M12 16v4"></path><path d="M4 12h3"></path><path d="M17 12h3"></path>`,
    "/docs/privacy": `<path d="M12 3 5 6v6c0 4.8 2.8 7.6 7 9 4.2-1.4 7-4.2 7-9V6l-7-3Z"></path><path d="m9 12 2 2 4-5"></path>`,
    "/docs/features": `<path d="M5 12h14"></path><path d="M12 5v14"></path><path d="m7 7 10 10"></path><path d="m17 7-10 10"></path>`,
    "/docs/use-cases": `<circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 4v3"></path><path d="M20 12h-3"></path>`,
  };

  return `<svg viewBox="0 0 24 24" fill="none">${icons[path] ?? icons["/docs"]}</svg>`;
}

function renderWorkflowRecipes(): string {
  return `<div class="recipe-grid">
    ${workflowRecipes
      .map(
        (recipe) => `<div class="recipe-card">
          <strong>${escapeHtml(recipe.title)}</strong>
          <p>${escapeHtml(recipe.useWhen)}</p>
          <pre><code>${escapeHtml(recipe.commands.join("\n"))}</code></pre>
          <small>${escapeHtml(recipe.notes)}</small>
        </div>`,
      )
      .join("")}
  </div>`;
}

function renderCommandOptions(command: string, options: CommandOption[] | undefined): string {
  if (!options?.length) return "";

  return `<div class="command-options">
    <strong>Options for <code>${escapeHtml(command)}</code></strong>
    <ul>
      ${options
        .map(
          (option) => `<li>
            <code>${escapeHtml(option.name)}</code>
            <span>${escapeHtml(option.description)}</span>
            <small><b>Use when:</b> ${escapeHtml(option.useWhen)}</small>
            <small><b>Example:</b> <code>${escapeHtml(option.example)}</code></small>
          </li>`,
        )
        .join("")}
    </ul>
  </div>`;
}

function renderCommandGroups(): string {
  return commandGroups
    .map((group) => {
      const rows = group.commands
        .map((item) => {
          const detail = commandDetails[item.command];
          const optionsText = detail?.options
            ?.map(
              (option) =>
                `${option.name} ${option.description} ${option.useWhen} ${option.example}`,
            )
            .join(" ");
          const search =
            `${group.title} ${item.command} ${item.description} ${detail?.recommendedUse ?? ""} ${detail?.example ?? ""} ${optionsText ?? ""}`.toLowerCase();
          return `<tr data-command-row data-search="${escapeHtml(search)}">
            <td><code>${escapeHtml(item.command)}</code></td>
            <td>
              <p>${escapeHtml(item.description)}</p>
              ${
                detail
                  ? `<div class="command-detail">
                    <div><strong>Use when</strong><span>${escapeHtml(detail.recommendedUse)}</span></div>
                    <div><strong>Example</strong><code>${escapeHtml(detail.example)}</code></div>
                    ${renderCommandOptions(item.command, detail.options)}
                  </div>`
                  : ""
              }
            </td>
            <td><button class="tiny-copy" type="button" data-copy-value="${escapeHtml(item.command)}">Copy</button></td>
          </tr>`;
        })
        .join("");

      return `<section class="command-group" data-command-group>
        <div class="command-group-head">
          <div>
            <h3>${group.title}</h3>
            <p>${group.intro}</p>
          </div>
          <span>${group.commands.length} commands</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Command</th>
                <th>What it does</th>
                <th><span class="sr-only">Copy</span></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
    })
    .join("");
}

function renderTable(items: TableItem[], label: string): string {
  const rows = items
    .map(
      (item) => `<tr>
        <td><code>${escapeHtml(item.name)}</code></td>
        <td>${escapeHtml(item.description)}</td>
      </tr>`,
    )
    .join("");

  return `<div class="table-wrap" aria-label="${label}">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Use</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderCodeBlock(title: string, id: string, code: string, compact = false): string {
  return `<div class="command-wrap ${compact ? "compact" : ""}">
    <div class="code-head">
      <span>${title}</span>
      <button class="copy-btn" type="button" data-copy-target="${id}">Copy</button>
    </div>
    <pre id="${id}"><code>${escapeHtml(code)}</code></pre>
    ${id === "install-code" ? '<p class="install-note">Reload Cursor after initialization so the MCP server and Cursor rule are picked up.</p>' : ""}
  </div>`;
}

function renderList(items: string[]): string {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderKeyIcon(): string {
  return `<svg viewBox="0 0 32 32" fill="none">
    <rect class="icon-fill" x="6.5" y="8" width="19" height="16" rx="4.5" stroke-width="1.4"></rect>
    <path class="icon-muted" d="M10 12h5.5M10 20.5h4" stroke-width="1.35" stroke-linecap="round"></path>
    <path class="icon-accent" d="M15.5 16.1a4 4 0 1 1 6.2 3.3l2.4 2.4h2.4v2.4H29" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"></path>
    <circle class="icon-accent" cx="18.3" cy="16.1" r="1" stroke-width="1.55"></circle>
  </svg>`;
}

function renderDatabaseIcon(): string {
  return `<svg viewBox="0 0 32 32" fill="none">
    <path class="icon-fill" d="M8 10.5c0-2.1 16-2.1 16 0v11c0 2.1-16 2.1-16 0v-11Z" stroke-width="1.4" stroke-linejoin="round"></path>
    <path class="icon-muted" d="M8 10.5c0 2.1 16 2.1 16 0M8 16c0 2.1 16 2.1 16 0" stroke-width="1.35"></path>
    <path class="icon-accent" d="M12 22.5h8M16 22.5V26" stroke-width="1.55" stroke-linecap="round"></path>
    <circle class="icon-accent" cx="16" cy="26" r="1.2" stroke-width="1.55"></circle>
  </svg>`;
}

function renderShieldIcon(): string {
  return `<svg viewBox="0 0 32 32" fill="none">
    <path class="icon-fill" d="M16 5.5 8.5 8.8v5.8c0 5 3.1 8.5 7.5 10.8 4.4-2.3 7.5-5.8 7.5-10.8V8.8L16 5.5Z" stroke-width="1.4" stroke-linejoin="round"></path>
    <path class="icon-muted" d="M12.2 13h7.6M12.2 17h5.4" stroke-width="1.35" stroke-linecap="round"></path>
    <path class="icon-accent" d="m11.5 21 9-10" stroke-width="1.55" stroke-linecap="round"></path>
  </svg>`;
}

function renderReadOnlyIcon(): string {
  return `<svg viewBox="0 0 32 32" fill="none">
    <path class="icon-muted" d="M10 8v16M22 8v5" stroke-width="1.35" stroke-linecap="round"></path>
    <path class="icon-muted" d="M10 16h7.5c2.5 0 4.5-2 4.5-4.5V8" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"></path>
    <circle class="icon-fill" cx="10" cy="8" r="2.8" stroke-width="1.4"></circle>
    <circle class="icon-fill" cx="10" cy="24" r="2.8" stroke-width="1.4"></circle>
    <path class="icon-accent" d="M20 19v-1.6a3 3 0 0 1 6 0V19M19 19h8v6h-8z" stroke-width="1.55" stroke-linejoin="round"></path>
  </svg>`;
}

function render(): void {
  const legacyRoute = legacyDocsHashes[window.location.hash];
  if (normalizePath(window.location.pathname) === "/" && legacyRoute) {
    window.history.replaceState({}, "", legacyRoute);
  }
  if (normalizePath(window.location.pathname) === "/docs/options") {
    window.history.replaceState({}, "", "/docs/cli");
  }

  const path = normalizePath(window.location.pathname);
  app.innerHTML = path.startsWith("/docs") ? renderDocsRoute(path) : renderHome();
  attachInteractions();
  revealVisibleElements();

  if (window.location.hash) {
    window.requestAnimationFrame(() => {
      document.querySelector(window.location.hash)?.scrollIntoView();
    });
  } else {
    window.scrollTo({ top: 0 });
  }
}

function attachInteractions(): void {
  const navToggle = document.querySelector<HTMLButtonElement>(".mobile-toggle");
  const navLinks = document.querySelector<HTMLElement>(".nav-links");

  navToggle?.addEventListener("click", () => {
    const isOpen = navLinks?.classList.toggle("is-open") ?? false;
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  navLinks?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.classList.remove("is-open");
      navToggle?.setAttribute("aria-expanded", "false");
    });
  });

  document.querySelectorAll<HTMLAnchorElement>("a[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(link.getAttribute("href") ?? "/");
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.copyTarget;
      const target = targetId ? document.getElementById(targetId) : null;
      const text = target?.innerText.trim();
      if (!text) return;

      await copyWithFeedback(button, text);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-copy-value]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.copyValue;
      if (!value) return;

      await copyWithFeedback(button, value);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-copy-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      await copyWithFeedback(button, window.location.href);
    });
  });

  const commandFilter = document.querySelector<HTMLInputElement>("#command-filter");
  const commandRows = Array.from(
    document.querySelectorAll<HTMLTableRowElement>("[data-command-row]"),
  );
  const commandGroupElements = Array.from(
    document.querySelectorAll<HTMLElement>("[data-command-group]"),
  );

  commandFilter?.addEventListener("input", () => {
    const query = commandFilter.value.trim().toLowerCase();

    commandRows.forEach((row) => {
      row.hidden = Boolean(query) && !(row.dataset.search ?? "").includes(query);
    });

    commandGroupElements.forEach((group) => {
      const rows = Array.from(group.querySelectorAll<HTMLTableRowElement>("[data-command-row]"));
      group.hidden = rows.every((row) => row.hidden);
    });
  });
}

function navigate(href: string): void {
  const target = new URL(href, window.location.origin);
  window.history.pushState({}, "", `${target.pathname}${target.hash}`);
  render();
}

function revealVisibleElements(): void {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14 },
  );

  document.querySelectorAll(".fade-up").forEach((element) => observer.observe(element));
}

async function copyWithFeedback(button: HTMLButtonElement, text: string): Promise<void> {
  const originalHtml = button.innerHTML;

  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select";
  }

  window.setTimeout(() => {
    button.innerHTML = originalHtml;
  }, 1400);
}

window.addEventListener("popstate", render);
render();
