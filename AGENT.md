# AGENT.md

This file provides guidance for AI coding agents working on this project.

## Project Overview

This is a **Tauri 2 + Next.js 16 + Elysia** monorepo starter. It provides:

- Cross-platform desktop app (Tauri)
- Web frontend (Next.js with static export)
- Backend API (Elysia with Bun runtime)
- Type-safe API client (Eden Treaty)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    apps/tauri (Desktop Shell)               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              apps/web (Next.js Frontend)              │  │
│  │  ┌─────────────────┐    ┌─────────────────────────┐   │  │
│  │  │ @workspace/ui   │    │ @workspace/api-client   │   │  │
│  │  │ (shadcn/ui)     │    │ (Eden Treaty)           │   │  │
│  │  └─────────────────┘    └───────────┬─────────────┘   │  │
│  └─────────────────────────────────────┼─────────────────┘  │
└────────────────────────────────────────┼────────────────────┘
                                         │ HTTP (localhost:3001)
                              ┌──────────▼──────────┐
                              │   apps/backend      │
                              │   (Elysia + Bun)    │
                              └─────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `apps/backend/src/index.ts` | Elysia API server entry point |
| `apps/web/app/` | Next.js App Router pages |
| `apps/tauri/src-tauri/tauri.conf.json` | Tauri configuration |
| `apps/tauri/src-tauri/src/lib.rs` | Rust commands and plugins |
| `packages/api-client/src/index.ts` | Eden Treaty client factory |
| `packages/ui/src/components/` | Shared React components |
| `turbo.json` | Turborepo task configuration |

## Development Commands

```bash
# Start all services
pnpm dev

# Start individual services
pnpm dev:web      # Next.js on localhost:3000
pnpm dev:backend  # Elysia on localhost:3001
pnpm dev:tauri    # Desktop app (starts web automatically)

# Quality checks
pnpm typecheck    # TypeScript checking
pnpm lint         # Biome linting
pnpm check        # Biome with auto-fix
pnpm knip         # Find unused code

# Build
pnpm build        # Build all (may fail without Rust)
pnpm turbo build --filter=web --filter=@workspace/backend  # Build web + backend only
```

## Code Style

This project uses **Biome** for linting and formatting:

- **No semicolons** in JavaScript/TypeScript
- **Double quotes** for strings
- **2-space** indentation
- **Import sorting** enabled
- **Type imports** should use `import type`

Run `pnpm check` to auto-fix issues before committing.

## Adding Features

### Adding a New API Route

1. Edit `apps/backend/src/index.ts`
2. Add routes using Elysia's chained API
3. Export the App type for Eden inference

```typescript
const app = new Elysia()
  .use(cors())
  // Add your route
  .get("/users", () => [{ id: 1, name: "John" }])
  .post("/users", ({ body }) => body, {
    body: t.Object({
      name: t.String()
    })
  })
  .listen(3001)

export type App = typeof app
```

### Using the API Client

```typescript
import { createApiClient } from "@workspace/api-client"

const api = createApiClient()
const { data, error } = await api.users.get()
```

### Adding a UI Component

```bash
# Add shadcn component
pnpm dlx shadcn@latest add card -c apps/web

# Import in your code
import { Card } from "@workspace/ui/components/card"
```

### Adding a Tauri Command

Edit `apps/tauri/src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn my_command(arg: String) -> String {
    format!("Received: {}", arg)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet, my_command])
        // ...
}
```

Call from frontend:

```typescript
import { invoke } from "@tauri-apps/api/core"

const result = await invoke("my_command", { arg: "hello" })
```

## Workspace Packages

| Package | Alias | Description |
|---------|-------|-------------|
| `packages/ui` | `@workspace/ui` | Shared React components |
| `packages/api-client` | `@workspace/api-client` | Eden Treaty API client |
| `packages/typescript-config` | `@workspace/typescript-config` | Shared TS configs |
| `apps/backend` | `@workspace/backend` | Elysia backend (type export only) |

## TypeScript Configurations

| Config | Used By |
|--------|---------|
| `base.json` | Root, api-client |
| `nextjs.json` | apps/web |
| `react-library.json` | packages/ui |
| `bun.json` | apps/backend |

## Environment Variables

Create `.env` files as needed:

- `apps/web/.env.local` - Next.js environment
- `apps/backend/.env` - Backend environment

## Testing

Currently no test framework is configured. Recommended additions:

- **Vitest** for unit testing
- **Playwright** for E2E testing

## Troubleshooting

### Tauri build fails

Ensure Rust is installed:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Backend won't start

Ensure Bun is installed:
```bash
curl -fsSL https://bun.sh/install | bash
```

### Type errors in api-client

Ensure backend types are exported correctly. The `@workspace/backend` package must export `App` type.

### Module resolution issues

Run `pnpm install` to ensure all workspace links are correct.

## Dependencies Update

When updating dependencies:

1. Update version in respective `package.json`
2. Run `pnpm install`
3. Run `pnpm typecheck` to verify compatibility
4. For Tauri, ensure `@tauri-apps/api` and `@tauri-apps/cli` versions match

## Notes for AI Agents

- Always run `pnpm typecheck` after making changes
- Use `pnpm check` to auto-fix linting issues
- The `@workspace/` prefix is an alias for internal packages
- Tauri requires Rust toolchain - some environments may not have it
- Backend uses Bun runtime, not Node.js
- Next.js is configured for static export (`output: "export"`)
