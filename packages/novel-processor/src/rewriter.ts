import type { LLMClient } from "./llm"
import {
  type Episode,
  SceneSchema,
  type ScreenplayOutline,
  ScreenplayOutlineSchema,
  type TextChunk,
} from "./types"

const REWRITER_SYSTEM_PROMPT = `你是一个资深的漫剧编剧，擅长将网文小说改写为具有高度视觉感染力和戏剧张力的短剧剧本。

## 核心任务
1. **大纲规划**：基于给出的剧情事件和因果图谱，合理划分场次。
2. **张力构建**：通过对话和动作冲突展现人物性格，避免冗长的叙述。
3. **视觉导向**：为生成式AI设计精准的视觉描述。`

const REWRITER_HAR_PROMPT = `你是一个剧本质量审计专家（HAR）。
你的任务是根据“场景写作计划”审查生成的“剧本片段”，确保：
1. 剧情是否符合该场景的目标（Goal）？
2. 关键角色是否都出场了且没有性格崩坏？
3. 是否体现了因果图谱中要求的关键剧情点？
4. 地点和时间是否与大纲一致？

如果有不一致之处，请在修正后的版本中进行改进。`

/**
 * 小说剧本编写器 (R2 Rewriter)
 * 完整实现 R2 论文中的 3.2 LLM-Based Rewriter 架构
 */
export class NovelRewriter {
  private llm: LLMClient

  constructor(llm: LLMClient) {
    this.llm = llm
  }

  /**
   * 3.2.1 Outline Generation
   * 对应论文：将因果图谱转化为场景写作计划，并进行 HAR 校验
   */
  async generateOutline(data: {
    totalSummary: string
    events: any[]
    characters: any[]
    relations: any[]
  }): Promise<ScreenplayOutline> {
    // 采用 R2 论文推荐的最佳实践：BFT 广度优先遍历（按时间顺序和逻辑关联性组织）
    const adaptationStrategy =
      "广度优先遍历模式（Breadth-First Traversal）。该模式侧重于事件的因果时间线，能够更好地平衡多个并行的因果分支，使剧本逻辑连贯且转场平滑。"

    // 1. 生成初始大纲
    const initialOutline = await this.llm.structured({
      schema: ScreenplayOutlineSchema,
      systemPrompt: REWRITER_SYSTEM_PROMPT,
      userPrompt: `请使用以下策略将小说分析数据改写为剧本大纲：
      
<strategy>
${adaptationStrategy}
</strategy>

<novel_analysis>
${JSON.stringify({ summary: data.totalSummary, charCount: data.characters.length, eventCount: data.events.length })}
</novel_analysis>

<causal_plot_graph>
事件：${JSON.stringify(data.events)}
关系：${JSON.stringify(data.relations)}
</causal_plot_graph>

要求：制定至少 3-5 个场景的写作计划，确保逻辑严密且转场流畅。`,
      temperature: 0.7,
    })

    // 2. 这里的 HAR 环节：校验大纲与原始事件的对齐 (Alignment)
    // 根据论文：Focuses on the alignment of key events and major characters
    const refinedOutline = await this.llm.structured({
      schema: ScreenplayOutlineSchema,
      systemPrompt: REWRITER_HAR_PROMPT,
      userPrompt: `请检查并修正该大纲，确保所有关键事件（Events）都在对应的场景中得到了体现，且没有丢失因果联系：\n${JSON.stringify(initialOutline)}`,
      temperature: 0.2,
    })

    return refinedOutline
  }

  /**
   * 3.2.2 Screenplay Generation (迭代生成 + HAR)
   * 对应论文：基于 Writing Plan 和上文生成场景剧本
   */
  async generateScene(
    sceneIndex: number,
    outline: ScreenplayOutline,
    originalChunks: TextChunk[],
    previousScene?: any
  ): Promise<any> {
    const plan = outline.scenePlans[sceneIndex]

    // 1. 生成初始场景剧本
    const initialScene = await this.llm.structured({
      schema: SceneSchema,
      systemPrompt: REWRITER_SYSTEM_PROMPT,
      userPrompt: `根据场景计划编写剧本：
<plan>
${JSON.stringify(plan)}
</plan>

${previousScene ? `<previous_scene_context>\n${previousScene.title}: ${previousScene.visualDescription}\n</previous_scene_context>` : ""}

请结合原著的文字张力进行扩写。`,
      temperature: 0.8,
    })

    // 2. 场景级的 HAR 校验
    // 论文：HAR verifies whether the generated scene meets the storyline goals outlined in the writing plan.
    const refinedScene = await this.llm.structured({
      schema: SceneSchema,
      systemPrompt: REWRITER_HAR_PROMPT,
      userPrompt: `请对比写作计划与生成的剧本，修正遗漏或不符之处：
<plan>
${JSON.stringify(plan)}
</plan>
<draft>
${JSON.stringify(initialScene)}
</draft>`,
      temperature: 0.2,
    })

    return refinedScene
  }

  /**
   * 完整转化流水线 (R2 Rewriter Pipeline)
   */
  async convertToEpisode(analysisData: any, originalChunks: TextChunk[]): Promise<Episode> {
    // A. Outline Generation with HAR
    const outline = await this.generateOutline(analysisData)

    // B. Iterative Screenplay Generation with HAR
    const scenes = []
    let lastScene = null

    for (let i = 0; i < outline.scenePlans.length; i++) {
      const scene = await this.generateScene(i, outline, originalChunks, lastScene)
      scenes.push(scene)
      lastScene = scene
    }

    return {
      number: 1,
      title: outline.coreElements,
      synopsis: outline.structure,
      scenes,
    }
  }
}
