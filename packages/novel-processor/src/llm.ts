import { createDeepSeek } from "@ai-sdk/deepseek"
import { createOpenAI } from "@ai-sdk/openai"
import { createVolcengine } from "@sweetretry/ai-sdk-volcengine-adapter"
import { generateText, type LanguageModel, Output } from "ai"
import type { z } from "zod"

/**
 * 支持的 LLM 提供商
 */
export type LLMProvider = "openai" | "volcengine" | "deepseek"

/**
 * LLM 客户端配置
 */
export interface LLMClientOptions {
  provider?: LLMProvider
  apiKey?: string
  baseURL?: string
  model?: string
}

/**
 * 默认模型配置
 */
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o",
  volcengine: "doubao-seed-1-8-251228",
  deepseek: "deepseek-chat",
}

/**
 * LLM 客户端封装
 *
 * 基于 Vercel AI SDK v6，支持多个提供商和结构化输出
 */
export class LLMClient {
  private model: LanguageModel

  constructor(options?: LLMClientOptions) {
    const provider = options?.provider ?? "deepseek"
    this.model = this.createModel(provider, options)
  }

  private createModel(provider: LLMProvider, options?: LLMClientOptions): LanguageModel {
    switch (provider) {
      case "volcengine": {
        const volcengine = createVolcengine({
          apiKey: options?.apiKey ?? process.env.ARK_API_KEY,
          baseURL: options?.baseURL,
        })
        return volcengine(options?.model ?? DEFAULT_MODELS.volcengine)
      }
      case "deepseek": {
        const deepseek = createDeepSeek({
          apiKey: options?.apiKey ?? process.env.DEEPSEEK_API_KEY,
          baseURL: options?.baseURL,
        })
        return deepseek(options?.model ?? DEFAULT_MODELS.deepseek)
      }
      case "openai":
      default: {
        const openai = createOpenAI({
          apiKey: options?.apiKey ?? process.env.OPENAI_API_KEY,
          baseURL: options?.baseURL ?? process.env.OPENAI_BASE_URL,
        })
        return openai(options?.model ?? DEFAULT_MODELS.openai)
      }
    }
  }

  /**
   * 带结构化输出的 LLM 调用
   *
   * 使用 AI SDK 的 generateText schema 形式
   */
  async structured<T extends z.ZodType>(options: {
    schema: T
    systemPrompt: string
    userPrompt: string
    temperature?: number
  }): Promise<z.infer<T>> {
    const { output } = await generateText({
      model: this.model,
      system: options.systemPrompt,
      prompt: options.userPrompt,
      temperature: options.temperature ?? 0.3,
      output: Output.object({
        schema: options.schema,
      }),
    })

    if (!output) {
      throw new Error("LLM 结构化输出失败")
    }

    return output as z.infer<T>
  }

  /**
   * 普通文本调用
   */
  async chat(options: {
    systemPrompt: string
    userPrompt: string
    temperature?: number
  }): Promise<string> {
    const { text } = await generateText({
      model: this.model,
      system: options.systemPrompt,
      prompt: options.userPrompt,
      temperature: options.temperature ?? 0.7,
    })

    return text
  }
}
