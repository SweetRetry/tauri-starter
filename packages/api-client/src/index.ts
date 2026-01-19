import { treaty } from "@elysiajs/eden"
import type { App } from "@workspace/backend"

export function createApiClient(baseUrl = "http://localhost:3001") {
  return treaty<App>(baseUrl)
}

export type { App }
export type ApiClient = ReturnType<typeof createApiClient>
