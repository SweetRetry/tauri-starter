import type { LLMClient } from "../libs/llm"
import { logger } from "../libs/logger"
import type { Character } from "../types"

const DESIGNER_SYSTEM_PROMPT = `你是一个角色视觉特征编译器，负责将文字描述转化为标准的视觉描述指令。

## 编译要求
1. **排除主观性**：禁止使用“美、丑、帅、酷、邪恶、温柔”等主观形容词。
2. **物理化描述**：
   - 脸型：使用具体几何或对比描述（如：方形下颌、高颧骨）。
   - 眼睛：描述形状与颜色（如：杏仁眼，深棕色虹膜）。
   - 服饰：描述材质、款式与层级（如：丝绸直襟长衫，外罩半透明纱衣）。
3. **色彩参数**：使用具体的颜色名称或 HSL 定义，而非模糊词汇。
4. **Prompt 规范**：输出适用于 AI 绘图引擎的英文描述段落，仅包含具象名词和状态动词。`

export class CharacterDesigner {
  private llm: LLMClient

  constructor(llm: LLMClient) {
    this.llm = llm
  }

  async designCharacter(character: Character): Promise<string> {
    logger.debug(`   - [Designer] 正在为角色《${character.name}》进行造型设计...`)

    const result = await this.llm.chat({
      systemPrompt: DESIGNER_SYSTEM_PROMPT,
      userPrompt: `角色姓名: ${character.name}\n角色描述: ${character.description}\n别名: ${character.aliases.join(", ")}\n\n请总结该角色的固定视觉特征指令（英文），用于 AI 绘图一致性。`,
    })

    return result
  }

  async run(characters: Character[]): Promise<Character[]> {
    logger.info(`   - [Designer] 开始批量设计 ${characters.length} 个角色的视觉指纹...`)

    const tasks = characters.map(async (char) => {
      const visualTraits = await this.designCharacter(char)
      return { ...char, visualTraits }
    })

    return Promise.all(tasks)
  }
}
