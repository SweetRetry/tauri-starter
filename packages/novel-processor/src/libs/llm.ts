import { createDeepSeek } from "@ai-sdk/deepseek"
import { generateText, type LanguageModel, Output } from "ai"
import type { z } from "zod"
import { logger } from "./logger"

/**
 * LLM 客户端配置
 */
export interface LLMClientOptions {
  apiKey?: string
  baseURL?: string
  model?: string
}

/**
 * 默认模型配置
 */
const DEFAULT_MODEL = "deepseek-chat"

/**
 * LLM 客户端封装 - 专注于 DeepSeek
 *
 * 基于 Vercel AI SDK v6
 */
export class LLMClient {
  private model: LanguageModel

  constructor(options?: LLMClientOptions) {
    this.model = this.createModel(options)
  }

  private createModel(options?: LLMClientOptions): LanguageModel {
    const deepseek = createDeepSeek({
      apiKey: options?.apiKey ?? process.env.DEEPSEEK_API_KEY,
      baseURL: options?.baseURL,
    })
    return deepseek(options?.model ?? DEFAULT_MODEL)
  }

  /**
   * 带结构化输出的 LLM 调用
   */
  async structured<T extends z.ZodType>(options: {
    schema: T
    systemPrompt: string
    userPrompt: string
  }): Promise<z.infer<T>> {
    const startTime = Date.now()
    logger.debug("[LLM] 发起结构化请求")

    try {
      const { output, usage } = await generateText({
        model: this.model,
        system: options.systemPrompt,
        prompt: options.userPrompt,
        output: Output.object({
          schema: options.schema,
        }),
      })

      const duration = Date.now() - startTime
      if (!output) {
        logger.error(`[LLM] 结构化输出为空 (耗时: ${duration}ms)`)
        throw new Error("LLM 结构化输出结果为空")
      }

      const inputTokens = usage?.inputTokens ?? 0
      const outputTokens = usage?.outputTokens ?? 0

      logger.debug(
        `[LLM] 请求完成 (耗时: ${duration}ms | Tokens: in=${inputTokens}, out=${outputTokens})`
      )

      return output as z.infer<T>
    } catch (error: unknown) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`[LLM] 请求失败 (耗时: ${duration}ms): ${errorMessage}`)
      if (error instanceof Error && error.stack) {
        logger.debug(`[LLM] 错误堆栈: ${error.stack}`)
      }
      throw error
    }
  }

  /**
   * 普通文本调用
   */
  async chat(options: { systemPrompt: string; userPrompt: string }): Promise<string> {
    const startTime = Date.now()
    logger.debug("[LLM] 发起普通文本请求")

    const { text, usage } = await generateText({
      model: this.model,
      system: options.systemPrompt,
      prompt: options.userPrompt,
    })

    const duration = Date.now() - startTime

    const inputTokens = usage?.inputTokens ?? 0
    const outputTokens = usage?.outputTokens ?? 0

    logger.debug(
      `[LLM] 请求完成 (耗时: ${duration}ms | Tokens: in=${inputTokens}, out=${outputTokens})`
    )

    return text
  }
}
