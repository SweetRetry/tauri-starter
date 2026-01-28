import type { LLMClient } from "../libs/llm"
import { logger } from "../libs/logger"
import {
  type Episode,
  type EpisodePlan,
  type Event,
  type NovelAnalysisData,
  type Scene,
  SceneSchema,
  type ScreenplayOutline,
  ScreenplayOutlineSchema,
  type SeriesPlan,
  SeriesPlanSchema,
} from "../types"

const REWRITER_SYSTEM_PROMPT = `你是一个剧本转化与分镜编译器，负责将文学素材编译为包含技术分镜的标准剧本。

## 转化准则
1. **台词复刻**：必须优先使用素材中提供的原著台词。
2. **场景正文**：包含对话和视觉描写，禁止描写人物内心逻辑。
3. **技术分镜 (Shots)**：在每个场景末尾，必须根据情节节奏，拆解为 1-3 个技术分镜。
   - 包含构图 (Composition): 如 Close-up, Wide shot。
   - 包含绘图指令 (Image Prompt): 描述主体的物理特征、光源和构图位置。`

export class NovelRewriter {
  private llm: LLMClient

  constructor(llm: LLMClient) {
    this.llm = llm
  }

  async planSeries(data: NovelAnalysisData): Promise<SeriesPlan> {
    const adaptationStrategy =
      "你是一个漫剧总导演。请根据提供的剧情事件量和因果关系，将这段故事拆分为若干集（Episode）。\n" +
      "原则：\n" +
      "1. 每集时长约 3-5 分钟。\n" +
      "2. 每集必须有明确的开端（Hook）、发展和高潮（Climax）。\n" +
      "3. 保持情节连贯，不要让某一集显得空洞或过于拥挤。\n" +
      "4. 根据分析数据中的事件数量，自动决定适合的总集数（Total Episodes）。"

    const baseSystemPrompt = `你是一个漫剧总导演，负责整部剧的系列规划。\n${adaptationStrategy}`

    const initialPlan = await this.llm.structured({
      schema: SeriesPlanSchema,
      systemPrompt: baseSystemPrompt,
      userPrompt: `请严格按照 JSON Schema 格式对以下小说分析数据进行分集规划：
      
<novel_summary>
${data.totalSummary}
</novel_summary>

<causal_plot_graph>
核心事件列表（请根据 ID 归类至各集）：
${data.events.map((e: Event) => `- [${e.id}] ${e.summary}`).join("\n")}
</causal_plot_graph>

要求：
1. 必须输出完整的 JSON 对象。
2. coreEvents 数组中必须只包含上述列表中存在的事件 ID。`,
    })

    logger.info(
      `   - [SeriesPlan] 全剧规划完成: 总计 ${initialPlan.totalEpisodes} 集, 故事线: ${initialPlan.overallArc.slice(0, 50)}...`
    )
    return initialPlan
  }

  async generateEpisodeOutline(
    episodePlan: EpisodePlan,
    data: NovelAnalysisData
  ): Promise<ScreenplayOutline> {
    const relevantEvents = data.events.filter((e: Event) => episodePlan.coreEvents.includes(e.id))

    const outline = await this.llm.structured({
      schema: ScreenplayOutlineSchema,
      systemPrompt: REWRITER_SYSTEM_PROMPT,
      userPrompt: `请为第 ${episodePlan.episodeNumber} 集《${episodePlan.title}》编写详细的分场大纲。
      
<episode_goal>
${episodePlan.synopsis}
</episode_goal>

<assigned_events>
${relevantEvents.map((e: Event) => `- ${e.summary} (${e.description})`).join("\n")}
</assigned_events>

要求：
1. 必须输出符合 Schema 的 JSON。
2. 场景切分点应在空间转换、时间跳跃或情节转折处。
3. 每个场景都要有明确的视觉焦点和戏剧冲突，确保所有分配的关键事件都得到体现。`,
    })

    return outline
  }

  async generateScene(
    sceneIndex: number,
    outline: ScreenplayOutline,
    previousScene?: Scene,
    previousPlan?: ScreenplayOutline["scenePlans"][0]
  ): Promise<Scene> {
    const plan = outline.scenePlans[sceneIndex]

    let continuityContext = ""
    if (previousScene) {
      continuityContext = `<previous_scene_actual_content>\n标题: ${previousScene.title}\n描述: ${previousScene.visualDescription}\n</previous_scene_actual_content>`
      logger.debug(`   - [SceneGen] 使用真实上下文衔接: ${previousScene.title}`)
    } else if (previousPlan) {
      continuityContext = `<previous_scene_intended_plan>\n前场目标: ${previousPlan.goal}\n前场角色: ${previousPlan.characters.join(", ")}\n注意：本场景是并行生成的，请确保剧情开端能自然衔接到上述前场计划的终点。\n</previous_scene_intended_plan>`
      logger.debug(`   - [SceneGen] 使用影子上下文衔接计划: ${previousPlan.goal.slice(0, 30)}...`)
    }

    const initialScene = await this.llm.structured({
      schema: SceneSchema,
      systemPrompt: REWRITER_SYSTEM_PROMPT,
      userPrompt: `根据场景计划编写剧本：
<current_scene_plan>
${JSON.stringify(plan)}
</current_scene_plan>

${continuityContext}

请结合原著的文字张力进行扩写，注重对话和动作描写。`,
    })

    logger.debug(
      `   - [SceneGen] 场景生成完毕: ${initialScene.title} (${initialScene.visualDescription.length} chars)`
    )
    return initialScene
  }

  private async runInParallel<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    concurrency = 5
  ): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let index = 0

    const next = async (): Promise<void> => {
      while (index < items.length) {
        const curIndex = index++
        results[curIndex] = await fn(items[curIndex], curIndex)
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, next)
    await Promise.all(workers)
    return results
  }

  async run(
    analysisData: NovelAnalysisData,
    options: { concurrency?: number } = {}
  ): Promise<Episode[]> {
    const concurrency = options.concurrency || 5

    logger.info("   --> 正在进行全剧分集规划 (Series Planning)...")
    const seriesPlan = await this.planSeries(analysisData)
    logger.info(`   --> 规划完成：共 ${seriesPlan.totalEpisodes} 集。`)

    const episodes: Episode[] = []

    for (const plan of seriesPlan.episodes) {
      logger.info(`\n📺 [第 ${plan.episodeNumber} 集] ${plan.title} - 正在生成大纲...`)
      const outline = await this.generateEpisodeOutline(plan, analysisData)

      logger.info(
        `   🎬 本集规划了 ${outline.scenePlans.length} 个场景，开始并发生成 (并发窗口: ${concurrency})...`
      )

      const scenes = await this.runInParallel(
        outline.scenePlans,
        async (_, i) => {
          const prevPlan = i > 0 ? outline.scenePlans[i - 1] : undefined
          return await this.generateScene(i, outline, undefined, prevPlan)
        },
        concurrency
      )

      episodes.push({
        number: plan.episodeNumber,
        title: plan.title,
        synopsis: plan.synopsis,
        scenes,
      })

      logger.info(`   ✅ 第 ${plan.episodeNumber} 集生成完毕。`)
    }

    return episodes
  }
}
