import { getEncoding, type Tiktoken } from "js-tiktoken"
import type { TextChunk } from "./types"

/**
 * 基于 token 的文本切块器
 *
 * 不依赖任何格式假设，纯粹按 token 数量切分
 */
export class TokenChunker {
  private encoder: Tiktoken
  private maxTokens: number
  private overlapTokens: number

  /**
   * @param maxTokens 每块最大 token 数，默认 20000
   * @param overlapTokens 块之间重叠的 token 数，默认 500
   */
  constructor(maxTokens = 20000, overlapTokens = 500) {
    this.encoder = getEncoding("cl100k_base") // GPT-4 使用的编码
    this.maxTokens = maxTokens
    this.overlapTokens = overlapTokens
  }

  /**
   * 计算文本的 token 数量
   */
  countTokens(text: string): number {
    return this.encoder.encode(text).length
  }

  /**
   * 将文本切分成块
   *
   * 策略：
   * 1. 尽量在段落边界切分（\n\n）
   * 2. 如果段落太长，在句子边界切分
   * 3. 确保每块尽量填满到 maxTokens 附近
   */
  chunk(text: string): TextChunk[] {
    const chunks: TextChunk[] = []
    const normalizedText = text.replace(/\r\n/g, "\n")

    // 初始分段
    const paragraphs = normalizedText.split(/\n\n+/)

    let currentContent = ""
    let currentTokens = 0
    let startChar = 0
    let charOffset = 0

    const flushChunk = () => {
      if (currentContent.trim()) {
        chunks.push({
          index: chunks.length,
          content: currentContent.trim(),
          tokenCount: currentTokens,
          startChar,
          endChar: charOffset,
        })

        // 为下一块准备重叠部分
        const overlap = this.getOverlapText(currentContent)
        currentContent = overlap
        currentTokens = this.countTokens(overlap)
        startChar = charOffset - overlap.length
      }
    }

    for (const para of paragraphs) {
      const paraWithBreak = `${para}\n\n`
      const paraTokens = this.countTokens(paraWithBreak)

      // 场景 A: 加上这个段落后超出限制，且当前已有内容
      if (
        currentTokens + paraTokens > this.maxTokens &&
        currentContent.length > this.overlapTokens + 10
      ) {
        flushChunk()
      }

      // 场景 B: 段落本身就超级长（超过 maxTokens）
      if (paraTokens > this.maxTokens) {
        // 如果当前有内容，先刷掉
        if (currentTokens > this.countTokens(this.getOverlapText(currentContent)) + 10) {
          flushChunk()
        }

        // 按句子进一步切割段落
        const sentences = para.split(/([。！？；]|\n)/g)
        for (let i = 0; i < sentences.length; i += 2) {
          const s = sentences[i] + (sentences[i + 1] || "")
          const sTokens = this.countTokens(s)

          if (currentTokens + sTokens > this.maxTokens) {
            flushChunk()
          }
          currentContent += s
          currentTokens += sTokens
          charOffset += s.length
        }
        // 处理完超长段落后的收尾
        currentContent += "\n\n"
        currentTokens += this.countTokens("\n\n")
        charOffset += 2
      } else {
        // 场景 C: 正常添加
        currentContent += paraWithBreak
        currentTokens += paraTokens
        charOffset += paraWithBreak.length
      }
    }

    // 处理最后剩余部分
    if (currentContent.trim() && currentContent.length > 20) {
      chunks.push({
        index: chunks.length,
        content: currentContent.trim(),
        tokenCount: currentTokens,
        startChar,
        endChar: charOffset,
      })
    }

    return chunks
  }

  /**
   * 获取用于重叠的文本（从末尾取）
   */
  private getOverlapText(text: string): string {
    const tokens = this.encoder.encode(text)
    if (tokens.length <= this.overlapTokens) {
      return text
    }

    const overlapTokens = tokens.slice(-this.overlapTokens)
    return this.encoder.decode(overlapTokens as number[])
  }

  /**
   * 获取文本统计信息
   */
  getStats(text: string): {
    totalChars: number
    totalTokens: number
    estimatedChunks: number
  } {
    const totalTokens = this.countTokens(text)
    return {
      totalChars: text.length,
      totalTokens,
      estimatedChunks: Math.ceil(totalTokens / this.maxTokens),
    }
  }

  dispose() {
    // js-tiktoken 不需要手动释放
  }
}
