# Anchor Demo Video Script

Target length: 2 minutes.

## Storyboard

1. Open with the problem.
   "Cursor can read the current code, but it does not automatically remember why the repo evolved this way."

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

5. Show diff review.
   Run:

   ```bash
   anchor review --share
   ```

   Explain that Anchor does not approve or reject code; it surfaces evidence-backed risks.

6. Show team adoption.
   Run:

   ```bash
   anchor prompts
   anchor rules suggest
   anchor health
   ```

   Mention that the coverage score is local-only and helps teams know whether Anchor's answers are trustworthy.

7. Close with setup.
   ```bash
   npm install -g @pratik7368patil/anchor
   anchor init
   anchor index --limit 50
   anchor health
   ```

## One-Line Positioning

Anchor gives Cursor local, cited repo memory from PR history, current code, tests, regressions, and team rules before it edits.
