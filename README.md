# Tauri Starter

A modern monorepo starter template for building cross-platform desktop applications with Tauri 2, Next.js 16, and Elysia backend.

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Desktop Shell | [Tauri](https://v2.tauri.app/) | 2.9.x |
| Frontend | [Next.js](https://nextjs.org/) | 16.1.x |
| UI Components | [shadcn/ui](https://ui.shadcn.com/) | - |
| Styling | [Tailwind CSS](https://tailwindcss.com/) | 4.x |
| Backend | [Elysia](https://elysiajs.com/) | 1.4.x |
| API Client | [Eden Treaty](https://elysiajs.com/eden/overview) | 1.4.x |
| Runtime | [Bun](https://bun.sh/) | 1.x |
| Build System | [Turborepo](https://turbo.build/repo) | 2.6.x |
| Linting | [Biome](https://biomejs.dev) | 1.9.x |
| Package Manager | [pnpm](https://pnpm.io/) | 10.x |

## Project Structure

```
tauri-starter/
├── apps/
│   ├── web/                  # Next.js frontend (also serves as Tauri frontend)
│   ├── backend/              # Elysia API server (Bun runtime)
│   └── tauri/                # Tauri desktop shell
├── packages/
│   ├── ui/                   # Shared React components (shadcn/ui)
│   ├── api-client/           # Eden Treaty client for type-safe API calls
│   └── typescript-config/    # Shared TypeScript configurations
├── biome.json                # Biome configuration
├── knip.json                 # Knip configuration
├── turbo.json                # Turborepo configuration
└── pnpm-workspace.yaml       # pnpm workspace config
```

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 20
- **pnpm** >= 10
- **Bun** >= 1.0
- **Rust** (stable)

### Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Tauri System Dependencies

Follow the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your operating system.

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start Development

**Backend only:**
```bash
pnpm dev:backend
```

**Web only:**
```bash
pnpm dev:web
```

**Tauri desktop app (includes web):**
```bash
pnpm dev:tauri
```

**All services:**
```bash
pnpm dev
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all development servers |
| `pnpm dev:web` | Start Next.js development server |
| `pnpm dev:backend` | Start Elysia backend server |
| `pnpm dev:tauri` | Start Tauri desktop app |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run Biome linter |
| `pnpm check` | Run Biome with auto-fix |
| `pnpm knip` | Find unused code |
| `pnpm tauri` | Access Tauri CLI |

## API Endpoints

The Elysia backend runs on `http://localhost:3001` by default:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Hello message |
| `/health` | GET | Health check with timestamp |

## Using the API Client

The `@workspace/api-client` package provides type-safe API calls using Eden Treaty:

```typescript
import { createApiClient } from "@workspace/api-client"

const api = createApiClient("http://localhost:3001")

// Type-safe API call
const { data } = await api.health.get()
console.log(data) // { status: "ok", timestamp: number }
```

## Building for Production

### Build Web + Backend

```bash
pnpm turbo build --filter=web --filter=@workspace/backend
```

### Build Tauri Desktop App

```bash
pnpm tauri build
```

This will create platform-specific installers in `apps/tauri/src-tauri/target/release/bundle/`.

## Adding New Routes (Backend)

Edit `apps/backend/src/index.ts`:

```typescript
const app = new Elysia()
  .use(cors())
  .get("/", () => "Hello from Elysia!")
  .get("/health", () => ({ status: "ok", timestamp: Date.now() }))
  // Add new routes here
  .get("/users", () => [{ id: 1, name: "John" }])
  .post("/users", ({ body }) => ({ created: true, ...body }))
  .listen(3001)
```

The Eden client will automatically infer types from your routes.

## Adding UI Components

To add shadcn/ui components, run at the project root:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Components will be placed in `packages/ui/src/components`.

Import components from the `@workspace/ui` package:

```tsx
import { Button } from "@workspace/ui/components/button"
```

## License

MIT
