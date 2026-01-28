/**
 * 小说处理器 - 交互式 Demo
 *
 * 每一步都会询问用户是否继续，适合逐步调试和观察效果
 *
 * 使用方法：
 * 1. 设置环境变量 ARK_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY
 * 2. 运行：bun run src/demo-interactive.ts
 */

import "dotenv/config"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { TokenChunker } from "./libs/chunker"
import { LLMClient } from "./libs/llm"
import { logger } from "./libs/logger"
import { mergeAnalyses, NovelAnalyzer } from "./modules/analyzer"
import { CharacterDesigner } from "./modules/designer"
import { NovelRewriter } from "./modules/rewriter"
import type { Character, ChunkAnalysis, Episode } from "./types"

// ============ 类型定义 ============
interface MergedPlotGraph {
  fullSummary: string
  allEvents: import("./types").Event[]
  allCharacters: Map<string, Character>
  allRelations: import("./types").CausalRelation[]
}

// ============ 配置 ============
const NOVEL_PATH = join(__dirname, "../assets/7421252097296829502_small.txt")
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16)
const OUTPUT_DIR = join(__dirname, "../output", timestamp)

// ============ 交互工具 ============

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
})

/**
 * 询问用户是否继续
 */
async function askContinue(stepName: string, details?: string): Promise<boolean> {
  console.log("")
  logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  logger.info(`🤔 即将执行: ${stepName}`)
  if (details) {
    logger.info(details)
  }
  logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

  const answer = await new Promise<string>((resolve) => {
    rl.question("➤ 是否继续? [Y/n/skip=跳过此步/q=退出]: ", resolve)
  })

  const normalized = answer.trim().toLowerCase()

  if (normalized === "q" || normalized === "quit" || normalized === "exit") {
    logger.info("👋 用户选择退出")
    process.exit(0)
  }

  if (normalized === "skip" || normalized === "s") {
    return false // 跳过此步骤
  }

  return normalized === "" || normalized === "y" || normalized === "yes"
}

/**
 * 询问用户输入数字
 */
async function askNumber(prompt: string, defaultValue: number): Promise<number> {
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${prompt} [默认: ${defaultValue}]: `, resolve)
  })
  const num = parseInt(answer.trim(), 10)
  return isNaN(num) ? defaultValue : num
}

// ============ 主流程 ============

async function main() {
  logger.info("📚 小说处理器 - 交互式 Demo (链路优化版)")
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  logger.info("每一步您可以选择：继续(Y)、跳过(skip)、退出(q)")
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

  // ===== 步骤 0: 检查环境 =====
  const hasApiKey =
    process.env.ARK_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY
  if (!hasApiKey) {
    logger.warn("⚠️  未检测到 LLM API Key")
    process.exit(1)
  }

  // ===== 步骤 1: 读取小说 =====
  const novelText = await readFile(NOVEL_PATH, "utf-8")
  logger.info(`   ✅ 字符数: ${novelText.length.toLocaleString()}`)

  // ===== 步骤 2: 文本统计 =====
  const chunker = new TokenChunker(8000, 500)
  const stats = chunker.getStats(novelText)
  logger.info(`   📊 预计切块数: ${stats.estimatedChunks}`)

  // ===== 步骤 3: 切块 =====
  const chunks = chunker.chunk(novelText)
  logger.info(`   ✅ 实际切分成 ${chunks.length} 块`)

  const maxChunks = await askNumber(
    `\n📋 共有 ${chunks.length} 个块，要分析多少个块?`,
    Math.min(3, chunks.length)
  )
  const chunksToAnalyze = chunks.slice(0, maxChunks)

  // ===== 步骤 4: LLM 深度分析 (已融合角色发现) =====
  const llm = new LLMClient()
  const analyzer = new NovelAnalyzer(llm)
  let analyses: ChunkAnalysis[] = []
  let globalCharacters: Character[] = []

  if (await askContinue("步骤 4/7: LLM 深度分析", "🔍 融合：事件提取 + 动态角色发现 + HAR")) {
    logger.info("   ⏳ 开始 LLM 融合分析（正在提取事件并动态发现角色）...")
    const result = await analyzer.run(chunksToAnalyze, {
      limit: maxChunks,
      onProgress: (stage, curr, tot) => {
        process.stdout.write(`\r   [${stage}] ${curr}/${tot} `)
        if (curr === tot) console.log()
      },
    })
    analyses = result.analyses
    globalCharacters = result.globalCharacters

    // 保存中间结果
    await writeFile(
      join(OUTPUT_DIR, "step_4_analyses.json"),
      JSON.stringify({ analyses, globalCharacters }, null, 2)
    )
    logger.info(`   ✅ 分析完成。结果已保存至 step_4_analyses.json`)
  } else {
    process.exit(0)
  }

  // ===== 步骤 5: 合并结果 (CPC) =====
  let merged: MergedPlotGraph = {
    fullSummary: "",
    allEvents: [],
    allCharacters: new Map(),
    allRelations: [],
  }
  if (await askContinue("步骤 5/7: 合并分析结果", "🔗 包含 LLM 语义去重与全局摘要生成")) {
    const rawMerged = mergeAnalyses(analyses, globalCharacters)
    const { globalSummary, eventIdMap } = await analyzer.consolidatePlotGraph({
      fullSummary: rawMerged.fullSummary,
      allEvents: rawMerged.allEvents,
      characters: Array.from(rawMerged.allCharacters.values()),
    })

    const deduplicatedEvents = rawMerged.allEvents.filter((e) => {
      const canonical = eventIdMap.get(e.id)
      return !canonical || canonical === e.id
    })

    const refinedRelations = rawMerged.allRelations.map((rel) => ({
      ...rel,
      fromEventId: eventIdMap.get(rel.fromEventId) || rel.fromEventId,
      toEventId: eventIdMap.get(rel.toEventId) || rel.toEventId,
    }))

    merged = {
      fullSummary: globalSummary,
      allEvents: deduplicatedEvents,
      allCharacters: rawMerged.allCharacters,
      allRelations: refinedRelations,
    }
    await writeFile(join(OUTPUT_DIR, "step_5_merged.json"), JSON.stringify(merged, null, 2))
    logger.info(`   ✅ 智能合并完成。结果已保存至 step_5_merged.json`)
  }

  // ===== 步骤 6: 角色视觉设计 =====
  let visualBible: Character[] = []
  const baseCharacters = Array.from(merged.allCharacters.values()) as Character[]
  if (await askContinue("步骤 6/7: 角色视觉设计")) {
    const designer = new CharacterDesigner(llm)
    visualBible = await designer.run(baseCharacters)
    await writeFile(
      join(OUTPUT_DIR, "step_6_visual_bible.json"),
      JSON.stringify(visualBible, null, 2)
    )
    logger.info(`   ✅ 视觉设计完成。结果已保存至 step_6_visual_bible.json`)
  } else {
    visualBible = baseCharacters
  }

  // ===== 步骤 7: 生成生产级剧本 =====
  let episodes: Episode[] = []
  if (await askContinue("步骤 7/7: 生成漫剧剧本 (含分镜)", "📝 已融合分镜生成到剧本创作环节")) {
    const rewriter = new NovelRewriter(llm)
    episodes = await rewriter.run({
      totalSummary: merged.fullSummary,
      events: merged.allEvents,
      characters: visualBible,
      relations: merged.allRelations,
    })

    // 预览
    console.log(`\n📊 最终剧本预览:`)
    for (const ep of episodes) {
      console.log(`   📺 [第 ${ep.number} 集] ${ep.title}`)
      for (const s of ep.scenes) {
        console.log(`       🎬 ${s.title} (${s.shots.length} 个分镜)`)
      }
    }

    // 保存
    const productionBundle = {
      metadata: {
        generatedAt: new Date().toISOString(),
        totalEpisodes: episodes.length,
        totalScenes: episodes.reduce((acc, ep) => acc + ep.scenes.length, 0),
        totalShots: episodes.reduce(
          (acc, ep) => acc + ep.scenes.reduce((sacc, s) => sacc + s.shots.length, 0),
          0
        ),
      },
      visualBible,
      episodes,
    }
    await writeFile(
      join(OUTPUT_DIR, "production_bundle.json"),
      JSON.stringify(productionBundle, null, 2)
    )
    logger.info(`\n🎉 处理流程全部完成！输出目录: ${OUTPUT_DIR}`)
  }

  chunker.dispose()
  rl.close()
}

main().catch((err) => {
  logger.error("Fatal", err)
  process.exit(1)
})
