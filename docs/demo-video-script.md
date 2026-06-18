# Anchor Demo Video Script

Target length: 2 minutes.

## Storyboard

1. Open with the problem.
   "AI coding agents can read the current code, but they do not automatically remember why the repo evolved this way."

2. Show the zero-token demo.
   Run:

   ```bash
   npx -y @pratik7368patil/anchor demo
   ```

   Point out that the demo uses bundled PR and code fixtures, no GitHub token, no SaaS, and no telemetry.

3. Show the before-edit workflow.
   Highlight `anchor_get_context` output:
   - cited PR evidence
   - confidence
   - current code check
   - codebase evidence
   - related tests
   - regression memory

4. Show file onboarding.
   Run:

   ```bash
   anchor explain src/auth/cache.ts --share
   ```

   Explain that this is compact Markdown for Slack, PR comments, or team handoff.

5. Show architecture memory.
   Run:

   ```bash
   anchor architecture --file src/auth/cache.ts
   anchor architecture --check
   ```

   Explain that Anchor infers current file areas, imports, symbols, folder patterns, and nearby tests locally so agents can follow the repo's existing architecture.

6. Show diff review.
   Run:

   ```bash
   anchor review --share
   ```

   Explain that Anchor does not approve or reject code; it surfaces evidence-backed risks.

7. Show team adoption.
   Run:

   ```bash
   anchor prompts
   anchor rules suggest
   anchor health
   ```

   Mention that the coverage score is local-only and helps teams know whether Anchor's answers are trustworthy.

8. Close with setup.
   ```bash
   npm install -g @pratik7368patil/anchor
   anchor init
   anchor index --limit 50
   anchor health
   ```

## One-Line Positioning

Anchor gives AI coding agents local, cited repo and org memory from PR history, current code, architecture patterns, tests, regressions, team rules, and cross-repo impact before they edit.
