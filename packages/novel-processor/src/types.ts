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

/** 角色信息 - 全局档案 */
export const CharacterSchema = z.object({
  id: z.string().describe("实体唯一ID，如 CHAR_001"),
  name: z.string().describe("规范化姓名（如：张三）"),
  aliases: z.array(z.string()).default([]).describe("角色的其他称呼/别名"),
  description: z.string().describe("角色详细描述"),
  firstAppearance: z.string().optional().describe("首次出现的场景描述"),
  importance: z.enum(["major", "minor", "extra"]).default("minor").describe("角色重要程度"),
  visualTraits: z
    .string()
    .optional()
    .describe("角色的视觉特征指令（用于 AI 绘图一致性），如：身材、发型、特色配饰、固定色系服装"),
})
export type Character = z.infer<typeof CharacterSchema>

/** 分片中出现的角色引用 - 保持轻量以节省 Token */
export const CharacterInChunkSchema = z.object({
  id: z.string().describe("对应全局角色档案的 ID"),
  name: z.string().describe("角色在分片中的姓名"),
  role: z.string().describe("该角色在本片段中的具体身份/行为简述"),
})
export type CharacterInChunk = z.infer<typeof CharacterInChunkSchema>

/** 实体对齐结果 */
export const EntityResolutionSchema = z.object({
  characters: z.array(CharacterSchema).describe("合并后的规范化实体列表"),
})
export type EntityResolution = z.infer<typeof EntityResolutionSchema>

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
  description: z
    .string()
    .describe("详细描述，要求必须包含原著中的关键台词原话、具体的动作细节和核心冲突点"),
  chapter: z.string().describe("事件所在章节（如：第一章、第十五章）"),
  location: z.string().optional().describe("发生地点"),
  time: z.string().optional().describe("时间描述（相对或绝对）"),
  characters: z.array(z.string()).default([]).describe("涉及的角色 ID 列表"),
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
  summary: z.string().describe("该分片的剧情摘要"),
  events: z.array(EventSchema).describe("提取的事件列表"),
  causalRelations: z.array(CausalRelationSchema).describe("事件间的因果逻辑"),
  characters: z.array(CharacterInChunkSchema).describe("本片段中活跃的角色引用"),
  discoveredCharacters: z
    .array(
      z.object({
        name: z.string().describe("角色姓名"),
        description: z.string().describe("该角色在该片段中展现出的外貌、性格或身份细节"),
      })
    )
    .default([])
    .describe("本分片新发现的角色（仅限初次出现或有重大身份补足的角色）"),
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

/** 镜头 - 漫剧生成的最小物理单元 */
export const ShotSchema = z.object({
  id: z.string(),
  type: z
    .enum(["close-up", "medium", "wide", "action", "POV", "over-the-shoulder"])
    .describe("镜头类型"),
  content: z.string().describe("镜头内容描述"),
  imagePrompt: z.string().describe("针对 AI 绘图生成的专业提示词 (英文最佳)"),
  dialogueRef: z.string().optional().describe("此镜头对应的台词（如有）"),
  duration: z.number().default(3).describe("预估镜头时长（秒）"),
  audioCues: z
    .array(
      z.object({
        type: z.enum(["sfx", "bgm", "env"]),
        label: z.string().describe("音效/背景音描述"),
        timestamp: z.number().describe("出现的回秒数"),
      })
    )
    .default([]),
})
export type Shot = z.infer<typeof ShotSchema>

/** 场景 - 漫剧的最小逻辑单元 */
export const SceneSchema = z.object({
  id: z.string(),
  title: z.string().describe("场景标题"),
  setting: z.string().describe("场景设定（地点、时间、氛围）"),
  characters: z.array(z.string()).default([]).describe("出场角色 ID"),
  dialogues: z
    .array(
      z.object({
        speaker: z.string().describe("说话者姓名/ID"),
        line: z.string().describe("台词"),
        emotion: z.string().optional().describe("情感/语气"),
        action: z.string().optional().describe("伴随的动作"),
      })
    )
    .describe("对话列表"),
  narration: z.string().optional().describe("旁白"),
  visualDescription: z.string().describe("该场景的整体视觉基调和氛围"),
  shots: z.array(ShotSchema).default([]).describe("技术分镜：将场景拆解为具体的绘画指令"),
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

/** 综合分析数据 - 用于剧本改写输入 */
export interface NovelAnalysisData {
  totalSummary: string
  events: Event[]
  characters: Character[]
  relations: CausalRelation[]
}

// ============================================
// Series Planner (分集规划)
// ============================================

/** 剧集规划 - 对应单集的大纲 */
export const EpisodePlanSchema = z.object({
  episodeNumber: z.number().describe("集数序号"),
  title: z.string().describe("该集标题"),
  coreEvents: z.array(z.string()).describe("该集必须包含的关键事件ID列表"),
  synopsis: z.string().describe("剧情梗概"),
  estimatedDuration: z.string().describe("预估时长（如：3-5分钟）"),
  reasoning: z.string().describe("分集理由（为什么在这里切分？）"),
})

/** 整体规划表 */
export const SeriesPlanSchema = z.object({
  totalEpisodes: z.number().describe("总集数"),
  overallArc: z.string().describe("整段剧情的故事弧线分析"),
  episodes: z.array(EpisodePlanSchema).describe("分集规划列表"),
})

export type SeriesPlan = z.infer<typeof SeriesPlanSchema>
export type EpisodePlan = z.infer<typeof EpisodePlanSchema>

// ============================================
// Consolidator (逻辑对齐与去重)
// ============================================

export const PlotGraphConsolidationSchema = z.object({
  globalSummary: z.string().describe("全集剧情梗概，逻辑连贯且无冗余"),
  eventMappings: z
    .array(
      z.object({
        originalId: z.string().describe("原始事件 ID"),
        canonicalId: z.string().describe("归并后的标准事件 ID"),
        reason: z.string().optional().describe("归并理由（如：内容完全重复）"),
      })
    )
    .describe("事件查重映射表"),
})

export type PlotGraphConsolidation = z.infer<typeof PlotGraphConsolidationSchema>
