# Development rules

- The user requires the root application and `workspaces/vercel` to stay synchronized for every change. In the authoring checkout they are separate Git repositories: `E:/Lumen` and `E:/Lumen/workspaces/vercel`.
- Apply shared `src/`, `server/`, and `config/` changes to both repositories. Keep shared tests, tools, assets, and dependency changes in sync when applicable. Run `node tools/workspace-sync-check.mjs` from the root before completing work.
- Preserve platform-specific files and settings: Vercel's API handler, gateway, deployment configuration, and split-asset build must not be replaced by the root desktop single-file build configuration.
- When the counterpart checkout is unavailable, report that synchronization remains outstanding; do not describe a one-sided change as fully complete.
- Read `HANDOFF.md` before development and update it with changes, actual validation results, and remaining release work. Preserve existing user changes.
- When asked to push shared changes, verify and push both repositories. Do not commit credentials, local runtime caches, test output, or generated release packages.
- The user explicitly prohibits calling local Docker: it is unusable on this machine. Keep Linux container/restart checks for CI or an authorized remote Linux environment; do not start or inspect local Docker.
- The user has authorized Windows, macOS and Android cloud-client development and packaging. Clients bundle UI and use https://lumen.rupa.best; they must not bundle or launch the music backend. Linux website deployment remains supported.
