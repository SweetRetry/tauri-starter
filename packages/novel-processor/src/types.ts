import { z } from "zod"

// ============================================
// 基础数据结构
// ============================================

/** 文本块 - 切分后的原始文本单元 */
export interface TextChunk {
  index: number
  content: string
  tokenCount: number
  startChar: number
  endChar: number
}

/** 角色信息 */
export const CharacterSchema = z.object({
  name: z.string().describe("角色名称"),
  aliases: z.array(z.string()).default([]).describe("角色的其他称呼/别名"),
  description: z.string().describe("角色简短描述"),
  firstAppearance: z.string().optional().describe("首次出现的场景描述"),
})
export type Character = z.infer<typeof CharacterSchema>

/** 角色预扫描 - 用于初步发现实体 */
export const CharacterDiscoverySchema = z.object({
  characters: z
    .array(
      z.object({
        name: z.string().describe("发现的角色名称"),
        description: z.string().describe("该角色在本片段中的身份/职责简述"),
      })
    )
    .default([]),
})
export type CharacterDiscovery = z.infer<typeof CharacterDiscoverySchema>

/** 事件/情节点 */
export const EventSchema = z.object({
  id: z.string().describe("事件唯一ID，格式如 E001"),
  summary: z.string().describe("事件一句话摘要"),
  description: z.string().describe("事件详细描述"),
  chapter: z.string().describe("事件所在章节（如：第一章、第十五章）"),
  location: z.string().optional().describe("发生地点"),
  time: z.string().optional().describe("时间描述（相对或绝对）"),
  characters: z.array(z.string()).default([]).describe("涉及的角色名称"),
  emotionalTone: z.string().describe("情感基调，如：紧张、平静、悲伤、欢乐、悬疑、战斗等"),
})
export type Event = z.infer<typeof EventSchema>

/** 因果关系 */
export const CausalRelationSchema = z.object({
  fromEventId: z.string().describe("原因事件ID"),
  toEventId: z.string().describe("结果事件ID"),
  strength: z.string().describe("因果关系强度，如：强、中、弱"),
  description: z.string().describe("因果关系说明"),
})
export type CausalRelation = z.infer<typeof CausalRelationSchema>

/** 块分析结果 */
export const ChunkAnalysisSchema = z.object({
  summary: z.string().describe("本块内容摘要（2-3句话）"),
  events: z.array(EventSchema).default([]).describe("提取的事件列表"),
  characters: z.array(CharacterSchema).default([]).describe("出场的角色"),
  causalRelations: z.array(CausalRelationSchema).default([]).describe("事件之间的因果关系"),
  sceneBreaks: z
    .array(
      z.object({
        position: z.string().describe("场景转换的位置描述"),
        reason: z.string().describe("判断为场景转换的原因"),
      })
    )
    .default([])
    .describe("检测到的场景转换点"),
})
export type ChunkAnalysis = z.infer<typeof ChunkAnalysisSchema>

// ============================================
// 剧集结构
// ============================================

/** 场景 - 漫剧的最小单元 */
export const SceneSchema = z.object({
  id: z.string(),
  title: z.string().describe("场景标题"),
  setting: z.string().describe("场景设定（地点、时间、氛围）"),
  characters: z.array(z.string()).describe("出场角色"),
  dialogues: z
    .array(
      z.object({
        speaker: z.string().describe("说话者"),
        line: z.string().describe("台词"),
        emotion: z.string().optional().describe("情感/语气"),
        action: z.string().optional().describe("伴随的动作"),
      })
    )
    .describe("对话列表"),
  narration: z.string().optional().describe("旁白"),
  visualDescription: z.string().describe("视觉描述（用于生成画面）"),
})
export type Scene = z.infer<typeof SceneSchema>

/** 剧集 */
export const EpisodeSchema = z.object({
  number: z.number(),
  title: z.string(),
  synopsis: z.string().describe("剧集摘要"),
  scenes: z.array(SceneSchema),
})
export type Episode = z.infer<typeof EpisodeSchema>

// ============================================
// Rewriter 模型 (剧本改写相关)
// ============================================

/** 场景写作计划 - 对应 R2 论文中的 Scene Writing Plan */
export const SceneWritingPlanSchema = z.object({
  title: z.string().describe("场景暂定名"),
  events: z.array(z.string()).describe("本场景涵盖的事件ID列表"),
  setting: z.object({
    location: z.string().describe("发生地点"),
    time: z.string().describe("出现时间"),
    atmosphere: z.string().describe("场景氛围背景"),
  }),
  goal: z.string().describe("本场景的核心剧情目标/冲突点"),
  characters: z.array(z.string()).describe("出场角色名单"),
  keyPlotPoints: z.array(z.string()).describe("必须体现的剧情关键点"),
})

/** 剧本大纲 - 对应 R2 论文中的 Screenplay Outline */
export const ScreenplayOutlineSchema = z.object({
  coreElements: z.string().describe("故事核心元素提取"),
  structure: z.string().describe("整体剧作结构说明"),
  scenePlans: z.array(SceneWritingPlanSchema).describe("按顺序排列的场景写作计划"),
})

export type ScreenplayOutline = z.infer<typeof ScreenplayOutlineSchema>
export type SceneWritingPlan = z.infer<typeof SceneWritingPlanSchema>
