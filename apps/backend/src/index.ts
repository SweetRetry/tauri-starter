import { cors } from "@elysiajs/cors"
import { openapi } from "@elysiajs/openapi"
import { Elysia } from "elysia"
import * as z from "zod"

const app = new Elysia()
  .use(cors())
  .use(
    openapi({
      path: "/openapi",
      documentation: {
        info: {
          title: "Tauri Starter API",
          version: "0.0.1",
          description: "Backend API for Tauri Starter",
        },
      },
      mapJsonSchema: {
        zod: z.toJSONSchema,
      },
    })
  )
  .get("/", () => "Hello from Elysia!", {
    detail: {
      summary: "Root endpoint",
      description: "Returns a simple greeting message",
      tags: ["General"],
    },
  })
  .get("/health", () => ({ status: "ok" as const, timestamp: Date.now() }), {
    detail: {
      summary: "Health check",
      description: "Returns the health status and current timestamp",
      tags: ["General"],
    },
    response: z.object({
      status: z.literal("ok"),
      timestamp: z.number(),
    }),
  })
  .listen(3001)

console.log(`Elysia running at http://${app.server?.hostname}:${app.server?.port}`)
console.log(`OpenAPI docs available at http://${app.server?.hostname}:${app.server?.port}/openapi`)

export type App = typeof app
