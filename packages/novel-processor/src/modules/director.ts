import { z } from "zod"
import type { LLMClient } from "../libs/llm"
import { logger } from "../libs/logger"
import { type Character, type Scene, type Shot, ShotSchema } from "../types"

const DIRECTOR_SYSTEM_PROMPT = `你是一个分镜编译器，负责将剧本场景拆解为标准的摄影指令。

## 镜头准则
1. **技术性定义**：使用标准镜头语言（Close-up, Medium Shot, Wide Shot, Low-angle, High-angle）。
2. **构图客观化**：描述画面中主体的相对位置（如：Subject on the left, foreground; object in the background）。
3. **Prompt 工程**：生成的英文 imagePrompt 应仅包含：物理对象、光线方向（Lighting）、材质感（Texture）和特定的摄影机参数。禁止使用“华丽的”、“震撼的”等非物理词汇。`

export class NovelDirector {
  private llm: LLMClient

  constructor(llm: LLMClient) {
    this.llm = llm
  }

  async createStoryboard(scene: Scene, visualBible: Character[]): Promise<Shot[]> {
    logger.debug(`   - [Director] 正在为场景《${scene.title}》设计分镜...`)

    const relevantCharacters = visualBible.filter((c) => scene.characters.includes(c.id))
    const bibleContext = relevantCharacters
      .map((c) => `[${c.id}] ${c.name} 视觉特征: ${c.visualTraits || c.description}`)
      .join("\n")

    const result = await this.llm.structured({
      schema: z.object({
        shots: z.array(ShotSchema),
      }),
      systemPrompt: DIRECTOR_SYSTEM_PROMPT,
      userPrompt: `## 角色视觉档案 (Visual Bible):
${bibleContext}

## 场景文学剧本:
标题: ${scene.title}
设定: ${scene.setting}
基调: ${scene.visualDescription}

对话与动作:
${scene.dialogues
  .map((d) => `${d.speaker} (${d.emotion || "平静"}): ${d.line} [动作: ${d.action || "无"}]`)
  .join("\n")}

请将上述场景拆解为分镜列表。每个分镜对应一张具体的画面，imagePrompt 必须是详细的英文提示词。`,
    })

    logger.debug(
      `   - [Director] 场景《${scene.title}》分镜设计完成，共 ${result.shots.length} 个镜头。`
    )
    return result.shots
  }

  async run(
    scenes: Scene[],
    visualBible: Character[]
  ): Promise<Array<{ sceneId: string; shots: Shot[] }>> {
    const results = []
    for (const scene of scenes) {
      const shots = await this.createStoryboard(scene, visualBible)
      results.push({ sceneId: scene.id, shots })
    }
    return results
  }
}
