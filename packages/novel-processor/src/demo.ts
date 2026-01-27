/**
 * 小说处理器 Demo
 *
 * 用凡人修仙传第一卷测试完整流程
 *
 * 使用方法：
 * 1. 设置环境变量 ARK_API_KEY（火山引擎）或 OPENAI_API_KEY
 * 2. 运行：bun run src/demo.ts
 *
 * 可选参数：
 *   --chunks-only    只切块，不调用 LLM
 *   --max-chunks=N   最多分析 N 个块（默认 2）
 */

import "dotenv/config"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { mergeAnalyses, NovelAnalyzer } from "./analyzer"
import { TokenChunker } from "./chunker"
import { LLMClient } from "./llm"
import { NovelRewriter } from "./rewriter"
import type { ChunkAnalysis } from "./types"

// 使用第一卷
const NOVEL_PATH = join(__dirname, "../assets/凡人修仙传_第一卷_上.txt")
const OUTPUT_DIR = join(__dirname, "../output")

// 解析命令行参数
const args = process.argv.slice(2)
const chunksOnly = args.includes("--chunks-only")
const maxChunksArg = args.find((a) => a.startsWith("--max-chunks="))
const maxChunks = maxChunksArg ? parseInt(maxChunksArg.split("=")[1], 10) : 3

/**
 * 获取 chunk 分析结果的缓存路径
 */
function getChunkCachePath(chunkIndex: number): string {
  return join(OUTPUT_DIR, `chunk_${chunkIndex}_analysis.json`)
}

/**
 * 加载已缓存的 chunk 分析结果
 */
async function loadCachedAnalysis(chunkIndex: number): Promise<ChunkAnalysis | null> {
  const cachePath = getChunkCachePath(chunkIndex)
  if (!existsSync(cachePath)) {
    return null
  }
  const content = await readFile(cachePath, "utf-8")
  return JSON.parse(content) as ChunkAnalysis
}

/**
 * 保存 chunk 分析结果到缓存
 */
async function saveCachedAnalysis(chunkIndex: number, analysis: ChunkAnalysis): Promise<void> {
  const cachePath = getChunkCachePath(chunkIndex)
  await writeFile(cachePath, JSON.stringify(analysis, null, 2))
}

async function main() {
  console.log("📚 小说处理器 Demo - 凡人修仙传第一卷\n")

  // 1. 读取小说
  console.log("1️⃣ 读取小说文件...")
  const novelText = await readFile(NOVEL_PATH, "utf-8")
  console.log(`   文件大小: ${(novelText.length / 1024).toFixed(2)} KB`)
  console.log(`   字符数: ${novelText.length.toLocaleString()}`)

  // 2. 统计信息
  console.log("\n2️⃣ 分析文本统计...")
  const chunker = new TokenChunker(20000, 500) // 50K tokens per chunk，避免 Lost in the Middle
  const stats = chunker.getStats(novelText)
  console.log(`   总 token 数: ${stats.totalTokens.toLocaleString()}`)
  console.log(`   预计切块数: ${stats.estimatedChunks}`)
  console.log(`   预估费用: ¥${((stats.totalTokens / 1000000) * 1.2).toFixed(2)} (输入) + 输出费用`)

  // 3. 切块
  console.log("\n3️⃣ 切分文本块...")
  const chunks = chunker.chunk(novelText)
  console.log(`   实际切分成 ${chunks.length} 块`)

  for (const chunk of chunks) {
    console.log(
      `   - 块 ${chunk.index}: ${chunk.tokenCount.toLocaleString()} tokens, ${chunk.content.length.toLocaleString()} chars`
    )
  }

  // 保存切块结果
  await mkdir(OUTPUT_DIR, { recursive: true })
  for (const chunk of chunks) {
    await writeFile(join(OUTPUT_DIR, `chunk_${chunk.index}.txt`), chunk.content)
  }
  console.log(`\n📁 切块结果已保存到 ${OUTPUT_DIR}/chunk_*.txt`)

  // 如果只切块，到此结束
  if (chunksOnly) {
    console.log("\n✅ 切块完成（--chunks-only 模式）")
    chunker.dispose()
    return
  }

  // 4. 检查 API key
  if (!process.env.ARK_API_KEY && !process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    console.log("\n⚠️  未设置 ARK_API_KEY、OPENAI_API_KEY 或 DEEPSEEK_API_KEY，跳过 LLM 分析步骤")
    console.log("   设置环境变量后重新运行，或使用 --chunks-only 只查看切块结果")
    chunker.dispose()
    return
  }

  // 5. LLM 分析
  const chunksToAnalyze = chunks.slice(0, maxChunks)
  const analyzeTokens = chunksToAnalyze.reduce((sum, c) => sum + c.tokenCount, 0)

  console.log(`\n4️⃣ 使用 LLM 分析内容...`)
  console.log(
    `   将分析 ${chunksToAnalyze.length} 个块（共 ${analyzeTokens.toLocaleString()} tokens）`
  )

  const llm = new LLMClient()
  const analyzer = new NovelAnalyzer(llm)
  let analyses: ChunkAnalysis[] = []

  // 检查缓存
  const cachedAnalyses = await Promise.all(chunksToAnalyze.map((c) => loadCachedAnalysis(c.index)))
  const allCached = cachedAnalyses.every((a) => a !== null)

  if (allCached) {
    console.log("   所有块均已缓存，直接加载...")
    analyses = cachedAnalyses as ChunkAnalysis[]
  } else {
    // 调用并行分析管道
    // 策略测试：仅对前 maxChunks 个块执行 Discovery 和 Extraction
    analyses = await analyzer.analyzeChunks(chunksToAnalyze, {
      limit: maxChunks,
      concurrency: 5,
      onProgress: (stage, current, total) => {
        const percent = Math.round((current / total) * 100)
        process.stdout.write(`\r   [${stage}] 进度: ${percent}% (${current}/${total})        `)
        if (current === total) console.log()
      },
    })

    // 保存新产生的分析结果到缓存
    for (let i = 0; i < analyses.length; i++) {
      if (!cachedAnalyses[i]) {
        await saveCachedAnalysis(chunksToAnalyze[i].index, analyses[i])
      }
    }
    console.log("   分析完成并已更新缓存")
  }

  // 6. 合并结果
  console.log("\n5️⃣ 合并分析结果 (Causal Plot-graph Construction)...")
  const merged = mergeAnalyses(analyses)

  // 7. Rewriter 阶段 - 生成剧本 (R2 论文核心逻辑)
  console.log("\n6️⃣ 使用 Rewriter 生成漫剧剧本 (R2 Pipeline)...")
  const rewriter = new NovelRewriter(llm)

  // A. 首先根据分析结果生成剧本大纲和场景计划
  console.log("   正在规划剧本大纲与场次...")
  const finalAnalysisData = {
    totalSummary: merged.fullSummary,
    events: merged.allEvents,
    characters: Array.from(merged.allCharacters.values()),
    relations: merged.allRelations,
  }

  const episode = await rewriter.convertToEpisode(finalAnalysisData, chunks)
  console.log(`\n✅ 剧本生成完成！包含 ${episode.scenes.length} 个场景`)

  // 8. 保存最终结果
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const resultFilename = `episode_result_${timestamp}.json`
  await writeFile(join(OUTPUT_DIR, resultFilename), JSON.stringify(episode, null, 2))

  console.log(`\n📊 剧本内容预览:`)
  console.log(`   主旨: ${episode.title}`)
  for (const scene of episode.scenes) {
    console.log(`   🎬 [场景] ${scene.title}`)
    console.log(`       地点: ${scene.setting}`)
    console.log(`       视觉建议: ${scene.visualDescription.slice(0, 50)}...`)
  }

  console.log(`\n📁 完整剧本已保存到 ${OUTPUT_DIR}/${resultFilename}`)

  chunker.dispose()
}

main().catch(console.error)
