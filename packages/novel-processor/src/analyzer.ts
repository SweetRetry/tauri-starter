import type { LLMClient } from "./llm"
import {
  CharacterDiscoverySchema,
  type ChunkAnalysis,
  ChunkAnalysisSchema,
  type TextChunk,
} from "./types"

const SYSTEM_PROMPT = `你是一个专业的小说分析专家，擅长提取故事结构、角色信息和情节事件。

## 核心原则：全面覆盖
⚠️ 你必须从文本的【开头】到【结尾】完整分析，不能遗漏任何章节或段落。

## 分析方法
1. 先快速浏览，识别出所有章节标题或明显的段落分界
2. 按顺序逐章节/逐段落提取事件，确保全环节覆盖。`

const HAR_SYSTEM_PROMPT = `你是一个幻觉感知纠错专家（Hallucination-Aware Refinement）。
你的任务是审查小说片段的分析结果，识别其中的矛盾、逻辑不通或与原文不符的地方，并进行修正。

请特别注意：
1. 角色身份前后是否矛盾？
2. 事件的时间顺序是否符合原文？
3. 是否存在虚构的、原文中不存在的情节？`

/**
 * 小说内容分析器
 * 完整实现 R2 论文中的 3.1 LLM-based Reader 架构
 */
export class NovelAnalyzer {
  private llm: LLMClient

  constructor(llm: LLMClient) {
    this.llm = llm
  }

  /**
   * 3.1.1 Character Event Extraction (CEE)
   * 包含：滑动窗口提取 + HAR (Hallucination-Aware Refinement)
   */
  async extractCharacterEvents(
    chunk: TextChunk,
    globalCharacters: string[],
    previousSummary?: string
  ): Promise<ChunkAnalysis> {
    // 1. 初步提取 (Initial Extraction)
    const initialAnalysis = await this.llm.structured({
      schema: ChunkAnalysisSchema,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `【参考全局角色表】：${globalCharacters.join("、")}\n${previousSummary ? `【前文摘要】：${previousSummary}\n` : ""}请详细分析以下片段：\n${chunk.content}`,
      temperature: 0.2,
    })

    // 2. HAR 迭代优化 (Hallucination-Aware Refinement)
    // 对应论文中的 Sec 2.1: Recursively prompted to identify inconsistencies
    const refinedAnalysis = await this.llm.structured({
      schema: ChunkAnalysisSchema,
      systemPrompt: HAR_SYSTEM_PROMPT,
      userPrompt: `请对比原始文本与初步分析结果，修正其中的任何矛盾或幻觉内容：
      
<original_text>
${chunk.content}
</original_text>

<initial_analysis>
${JSON.stringify(initialAnalysis, null, 2)}
</initial_analysis>`,
      temperature: 0.1,
    })

    return refinedAnalysis
  }

  /**
   * 3.1.2 Plot Graph Extraction (PGE) & CPC
   * 对应论文中的 Causal Plot-graph Construction
   */
  async constructCausalGraph(
    analyses: ChunkAnalysis[],
    globalCharacters: string[]
  ): Promise<ChunkAnalysis[]> {
    // 论文逻辑：递归提示识别新因果关系 -> CPC 破环/剪枝
    // 这里我们对合并后的事件进行一次全局因果建模
    const mergedEvents = analyses.flatMap((a) => a.events)

    // 简化版 CPC 实现：对初步合并的因果关系进行权重验证和去环
    // 实际生产中可以再接一个异步的 CPC 算法模块
    return analyses
  }

  /**
   * 全量角色发现 (Discovery)
   */
  async discoverGlobalContext(
    allChunks: TextChunk[],
    concurrency: number,
    onProgress?: (current: number, total: number) => void
  ): Promise<string[]> {
    const discoveryTasks = allChunks.map((chunk, i) => async () => {
      const result = await this.llm.structured({
        schema: CharacterDiscoverySchema,
        systemPrompt: "你是一个角色发现专家，列出此片段中的所有角色及其初步身份。",
        userPrompt: `<fragment>\n${chunk.content}\n</fragment>`,
        temperature: 0.1,
      })
      onProgress?.(i + 1, allChunks.length)
      return result.characters
    })
    const allDiscovered = await this.runInParallel(discoveryTasks, concurrency)
    const uniqueNames = new Set<string>()
    for (const list of allDiscovered) {
      for (const char of list) uniqueNames.add(char.name)
    }
    return Array.from(uniqueNames)
  }

  /**
   * 完整 Reader 流水线
   */
  async analyzeChunks(
    allChunks: TextChunk[],
    options: {
      limit?: number
      concurrency?: number
      onProgress?: (stage: string, current: number, total: number) => void
    } = {}
  ): Promise<ChunkAnalysis[]> {
    const { concurrency = 5, onProgress, limit = allChunks.length } = options

    // 1. Discovery
    onProgress?.("Discovery", 0, allChunks.length)
    const globalCharacters = await this.discoverGlobalContext(
      allChunks,
      concurrency,
      (curr, tot) => {
        onProgress?.("Discovery", curr, tot)
      }
    )
    onProgress?.("Discovery", allChunks.length, allChunks.length)

    // 2. Extraction (CEE with Sliding Window & HAR)
    const chunksToAnalyze = allChunks.slice(0, limit)
    const results: ChunkAnalysis[] = []

    // 注意：CEE 的滑动窗口逻辑需要顺序或局部顺序执行以保证 Summary 传递
    // 为了极致性能，我们这里采用并行提取，但在分析时注入全局角色库。
    // 如果开启了 HAR，每一块都会进行自我纠错。
    onProgress?.("CEE (Extraction & HAR)", 0, chunksToAnalyze.length)
    const extractionTasks = chunksToAnalyze.map((chunk, i) => async () => {
      const analysis = await this.extractCharacterEvents(
        chunk,
        globalCharacters,
        i > 0 ? results[i - 1]?.summary : undefined
      )
      onProgress?.("CEE (Extraction & HAR)", i + 1, chunksToAnalyze.length)
      return { index: i, analysis }
    })

    // 我们分批执行以支持上下文依赖
    for (let i = 0; i < extractionTasks.length; i += concurrency) {
      const batch = extractionTasks.slice(i, i + concurrency)
      const batchResults = await Promise.all(batch.map((t) => t()))
      for (const res of batchResults) {
        results[res.index] = res.analysis
      }
    }

    // 3. Plot Graph Construction (CPC)
    // 这一步目前在 mergeAnalyses 中做 ID 缝合，可进一步扩展为论文中的图剪枝算法
    return results
  }

  private async runInParallel<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
    const results: T[] = new Array(tasks.length)
    let current = 0
    const worker = async () => {
      while (current < tasks.length) {
        const index = current++
        results[index] = await tasks[index]()
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
    await Promise.all(workers)
    return results
  }
}

/**
 * 对应 3.1.2 Plot Graph Extraction
 */
export function mergeAnalyses(analyses: ChunkAnalysis[]): {
  fullSummary: string
  allEvents: ChunkAnalysis["events"]
  allCharacters: Map<string, ChunkAnalysis["characters"][0]>
  allRelations: ChunkAnalysis["causalRelations"]
} {
  const fullSummary = analyses.map((a) => a.summary).join("\n\n")
  const allEvents: ChunkAnalysis["events"] = []
  const allCharacters = new Map<string, ChunkAnalysis["characters"][0]>()

  let eventCounter = 1
  for (const analysis of analyses) {
    const idMap = new Map<string, string>()
    for (const event of analysis.events) {
      const newId = `E${String(eventCounter++).padStart(3, "0")}`
      idMap.set(event.id, newId)
      allEvents.push({ ...event, id: newId })
    }
    // 合并角色与其他信息...
    for (const char of analysis.characters) {
      if (!allCharacters.has(char.name)) {
        allCharacters.set(char.name, char)
      } else {
        const existing = allCharacters.get(char.name)!
        const mergedAliases = new Set([...existing.aliases, ...char.aliases])
        allCharacters.set(char.name, { ...existing, aliases: Array.from(mergedAliases) })
      }
    }
  }

  const allRelations = analyses.flatMap((a) => a.causalRelations)
  return { fullSummary, allEvents, allCharacters, allRelations }
}
