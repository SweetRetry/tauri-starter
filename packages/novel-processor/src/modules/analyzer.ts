import type { LLMClient } from "../libs/llm"
import { logger } from "../libs/logger"
import {
  type Character,
  type ChunkAnalysis,
  ChunkAnalysisSchema,
  EntityResolutionSchema,
  PlotGraphConsolidationSchema,
  type TextChunk,
} from "../types"

const SYSTEM_PROMPT = `你是一个叙事分析引擎，负责从小说文本中提取结构化要素。

## 提取准则
1. **角色引用**：优先使用【已有角色列表】中的唯一 ID。
2. **新角色发现**：若出现不在列表中的新实体，请在 discoveredCharacters 中记录，描述其物理特征与身份。
3. **文本忠实度**：所有事件必须有明确原文支撑，禁用模糊词。
4. **因果链路**：标注逻辑因果 (Cause & Effect)。`

const HAR_SYSTEM_PROMPT = `你是一个幻觉感知纠错专家（Hallucination-Aware Refinement）。
你的任务是审查小说片段的分析结果，识别其中的矛盾、逻辑不通或与原文不符的地方，并进行修正。

请特别注意：
1. 角色身份前后是否矛盾？
2. 事件的时间顺序是否符合原文？
3. 是否存在虚构的、原文中不存在的情节？`

export class NovelAnalyzer {
  private llm: LLMClient

  constructor(llm: LLMClient) {
    this.llm = llm
  }

  async extractChunkParallel(chunk: TextChunk, previousSummary?: string): Promise<ChunkAnalysis> {
    const analysis = await this.llm.structured({
      schema: ChunkAnalysisSchema,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `${previousSummary ? `## 前文背景:\n${previousSummary}\n` : ""}## 待分析分片 内容:\n${chunk.content}\n\n请提取本分片摘要、事件、角色引用，并记录任何新发现的角色原型。`,
    })

    const refined = await this.llm.structured({
      schema: ChunkAnalysisSchema,
      systemPrompt: HAR_SYSTEM_PROMPT,
      userPrompt: `请对比原始文本与初步分析结果，修正任何幻觉或矛盾：\n<text>${chunk.content}</text>\n<analysis>${JSON.stringify(analysis)}</analysis>`,
    })

    return refined
  }

  async resolveEntities(
    rawDiscovered: Array<{ name: string; description: string }>
  ): Promise<Character[]> {
    if (rawDiscovered.length === 0) return []

    const nameMap = new Map<string, Set<string>>()
    for (const item of rawDiscovered) {
      if (!nameMap.has(item.name)) {
        nameMap.set(item.name, new Set())
      }
      nameMap.get(item.name)?.add(item.description)
    }

    const aggregatedInputs = Array.from(nameMap.entries()).map(([name, descSet]) => ({
      name,
      descriptions: Array.from(descSet).slice(0, 5),
    }))

    const resolutionResult = await this.llm.structured({
      schema: EntityResolutionSchema,
      systemPrompt: `你是一个专业的文学实体对齐专家。识别出指向同一个人的多个条目并合并。
1. **身份对齐**：通过描述确认同一人。
2. **规范化**：选最正式名字，其他放 aliases。
3. **ID分配**：分配唯一 ID（如 CHAR_001）。`,
      userPrompt: `以下是提取到的预聚合角色数据，请进行对齐合并：\n${JSON.stringify(aggregatedInputs, null, 2)}`,
    })

    logger.debug(`   - [EntityResolution] 收敛为 ${resolutionResult.characters.length} 个全局实体`)
    return resolutionResult.characters
  }

  async run(
    allChunks: TextChunk[],
    options: {
      limit?: number
      concurrency?: number
      onProgress?: (stage: string, current: number, total: number) => void
    } = {}
  ): Promise<{ analyses: ChunkAnalysis[]; globalCharacters: Character[] }> {
    const { limit = allChunks.length, concurrency = 10, onProgress } = options
    const chunksToAnalyze = allChunks.slice(0, limit)

    onProgress?.("Parallel Mapping", 0, chunksToAnalyze.length)
    const mapTasks = chunksToAnalyze.map((chunk, i) => async () => {
      const analysis = await this.extractChunkParallel(chunk)
      onProgress?.("Parallel Mapping", i + 1, chunksToAnalyze.length)
      return { index: i, analysis }
    })

    const mapResultsRaw = await this.runInParallel(mapTasks, concurrency)
    const analyses: ChunkAnalysis[] = new Array(chunksToAnalyze.length)
    let allDiscoveredRaw: Array<{ name: string; description: string }> = []

    for (const res of mapResultsRaw) {
      analyses[res.index] = res.analysis
      if (res.analysis.discoveredCharacters) {
        allDiscoveredRaw = allDiscoveredRaw.concat(
          res.analysis.discoveredCharacters.map((c) => ({
            name: c.name,
            description: c.description,
          }))
        )
      }
    }

    onProgress?.("Entity Resolution", 0, 1)
    const globalCharacters = await this.resolveEntities(allDiscoveredRaw)
    onProgress?.("Entity Resolution", 1, 1)

    return { analyses, globalCharacters }
  }

  async consolidatePlotGraph(data: {
    fullSummary: string
    allEvents: import("../types").Event[]
    characters: Character[]
  }): Promise<{ globalSummary: string; eventIdMap: Map<string, string> }> {
    const eventContext = data.allEvents.map((e) => `[${e.id}] ${e.summary}`).join("\n")

    const consolidation = await this.llm.structured({
      schema: PlotGraphConsolidationSchema,
      systemPrompt: `你是一个剧情逻辑审计引擎。负责执行‘语义去重’和‘全局摘要生成’。`,
      userPrompt: `## 事件列表:\n${eventContext}\n\n请识别重复事件 ID 并生成全局摘要。`,
    })

    const eventIdMap = new Map<string, string>()
    for (const mapping of consolidation.eventMappings) {
      eventIdMap.set(mapping.originalId, mapping.canonicalId)
    }

    return { globalSummary: consolidation.globalSummary, eventIdMap }
  }

  private async runInParallel<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
    const results: T[] = new Array(tasks.length)
    let currentIndex = 0
    const worker = async () => {
      while (currentIndex < tasks.length) {
        const index = currentIndex++
        results[index] = await tasks[index]()
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
    await Promise.all(workers)
    return results
  }
}

export function mergeAnalyses(
  analyses: ChunkAnalysis[],
  globalCharacters: Character[]
): {
  fullSummary: string
  allEvents: ChunkAnalysis["events"]
  allCharacters: Map<string, Character>
  allRelations: ChunkAnalysis["causalRelations"]
} {
  const fullSummary = analyses.map((a) => a.summary).join("\n\n")
  const allEvents: ChunkAnalysis["events"] = []
  const allRelations: ChunkAnalysis["causalRelations"] = []
  const allCharacters = new Map<string, Character>()

  for (const char of globalCharacters) {
    allCharacters.set(char.id, char)
  }

  let eventCounter = 1
  for (const analysis of analyses) {
    const chunkEventIdMap = new Map<string, string>()
    for (const event of analysis.events) {
      const globalId = `E${String(eventCounter++).padStart(3, "0")}`
      chunkEventIdMap.set(event.id, globalId)
      allEvents.push({ ...event, id: globalId })
    }
    for (const relation of analysis.causalRelations) {
      const fromGlobal = chunkEventIdMap.get(relation.fromEventId)
      const toGlobal = chunkEventIdMap.get(relation.toEventId)
      if (fromGlobal && toGlobal) {
        allRelations.push({ ...relation, fromEventId: fromGlobal, toEventId: toGlobal })
      }
    }
  }

  return { fullSummary, allEvents, allCharacters, allRelations }
}
