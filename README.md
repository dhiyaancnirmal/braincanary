# BrainCanary

Progressive canary deployment engine for AI applications powered by Braintrust scores.

## Packages

- `@braincanary/core` — config, statistics, state machine, monitor, persistence
- `@braincanary/proxy` — OpenAI-compatible proxy + deployment daemon
- `@braincanary/cli` — deployment operations CLI
- `@braincanary/dashboard` — single-page deployment dashboard
- `@braincanary/sdk` — client wrappers for app integration
- `@braincanary/demo` — demo support-agent simulator

## Quickstart

```bash
pnpm install
pnpm build
```

Start daemon:

```bash
pnpm --filter @braincanary/proxy dev
```

Deploy config:

```bash
pnpm --filter @braincanary/cli dev deploy --config apps/demo/braincanary.config.yaml
```

Dashboard:

```text
http://127.0.0.1:4100/dashboard
```
# braincanary
