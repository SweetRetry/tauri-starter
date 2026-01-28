# Novel Processor

小说处理器 - 将长文本小说转换为漫剧（视觉小说/动态漫画）生产级资产的自动化流水线。

本模块基于 R2 (Rewrite-Render) 论文思想，实现了一个从小说文本到完整分镜表的端到端处理流程。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Novel Processor Pipeline                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────┐ │
│  │   Chunker   │────▶│   Reader    │────▶│   Designer  │────▶│ Rewriter  │ │
│  │   (切块)    │     │   (分析)    │     │   (设计)    │     │  (改写)   │ │
│  └─────────────┘     └─────────────┘     └─────────────┘     └─────┬─────┘ │
│                                                                     │       │
│     TextChunks ──▶  AnalysisData  ──▶ VisualBible  ──▶  Episodes   │       │
│                                                         (剧本集)    │       │
│                                                                     ▼       │
│                                                              ┌───────────┐  │
│                                                              │  Director │  │
│                                                              │  (导演)   │  │
│                                                              └─────┬─────┘  │
│                                                                    │        │
│                                                                    ▼        │
│                                                           Production Bundle │
│                                                        (含分镜的完整剧集)     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. TokenChunker (`libs/chunker.ts`)

**职责**: 将长文本小说切分为 LLM 可处理的文本块

**关键特性**:
- 基于 Token 的智能切分（使用 `js-tiktoken` + cl100k_base 编码）
- 支持块间重叠（overlap）保持上下文连续性
- 优先在段落边界切分，超长段落按句子边界切分
- 提供切分统计和预估 Token 消耗

**配置参数**:
```typescript
new TokenChunker(maxTokens = 8000, overlapTokens = 500)
```

### 2. NovelAnalyzer (`modules/analyzer.ts`)

**职责**: 小说内容深度分析（对应 R2 论文中的 **Reader** 模块）

**处理流程**:

```
┌─────────────────────────────────────────────────────────────┐
│                    NovelAnalyzer Pipeline                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Discovery ──▶ Resolution ──▶ CEE (Extraction) ──▶ Merge   │
│  (角色发现)    (实体消解)      (事件提取+HAR)       (合并)   │
│                                                             │
│  1. 并行扫描所有分片，提取角色名称和描述                        │
│  2. 实体消解：合并同一角色的多个引用，生成全局角色档案            │
│  3. CEE: 滑动窗口提取事件、角色行为、因果关系                    │
│  4. HAR: 幻觉感知纠错，修正与原文不符的内容                     │
│  5. Merge: 合并所有分片分析结果，构建统一因果图                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**关键技术**:
- **Sliding Window Context**: 每个分片分析时传入前一片摘要，保持连贯性
- **Hallucination-Aware Refinement (HAR)**: 两轮 LLM 调用，先提取后纠错
- **Entity Resolution**: 借鉴 GraphRAG 思路，将散落角色描述对齐合并

**输出数据** (`AnalysisData`):
- `events`: 事件列表（含原文引用、关键台词）
- `characters`: 全局角色档案（ID、别名、描述、重要性）
- `relations`: 事件间因果关系
- `fullSummary`: 完整内容摘要

### 3. CharacterDesigner (`modules/designer.ts`)

**职责**: 为角色生成**视觉指纹**（Visual Bible），确保 AI 绘图一致性

**设计原则**:
- ❌ 排除主观形容词（美、丑、帅、酷）
- ✅ 物理化描述（脸型、眼型、服饰材质、具体色彩）
- ✅ 输出英文 Prompt 格式，可直接用于 AI 绘图引擎

**输出示例**:
```
A young man with square jawline, high cheekbones. Almond-shaped eyes with 
dark brown iris. Wearing silk straight-lapel robe with semi-transparent 
outer gauze garment. Color palette: midnight blue (HSL 240°, 80%, 30%) 
with silver trim.
```

### 4. NovelRewriter (`modules/rewriter.ts`)

**职责**: 将分析数据转换为漫剧剧本（对应 R2 论文中的 **Rewriter** 模块）

**处理流程**:

```
┌────────────────────────────────────────────────────────────────┐
│                   NovelRewriter Pipeline                       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Series Planning ──▶ Episode Outline ──▶ Scene Generation     │
│     (分集规划)         (分场大纲)          (场景生成)           │
│                                                                │
│  1. 根据事件量和剧情密度，自动决定总集数                         │
│  2. 每集分配核心事件，确保每集有 Hook/Climax                   │
│  3. 为每集生成场景写作计划 (Scene Writing Plan)                 │
│  4. 并发生成场景，使用影子上下文保持连贯性                      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**关键技术**:
- **Series Planning**: 自动分集，每集约 3-5 分钟时长
- **Ghost Context**: 并行生成场景时，使用前一场的计划大纲作为影子上下文
- **台词复刻**: 优先使用原著台词，保持角色核心语感

**输出数据** (`Episode[]`):
- 每集包含标题、梗概、多个场景
- 每个场景包含设定、对话、旁白、视觉描述

### 5. NovelDirector (`modules/director.ts`)

**职责**: 将文学剧本转换为技术分镜表（Storyboard）

**处理流程**:

```
Scene + VisualBible ──▶ Shot List
                         │
                         ▼
              ┌─────────────────────┐
              │  Shot 1:            │
              │  - Type: Close-up   │
              │  - Content: ...     │
              │  - ImagePrompt: ... │
              │  - Duration: 3s     │
              └─────────────────────┘
```

**输出** (`Shot[]`):
- 镜头类型（close-up / medium / wide / action / POV / over-the-shoulder）
- 画面内容描述
- AI 绘图专用英文 Prompt（含光线、材质、摄影参数）
- 对应台词引用
- 预估时长和音效提示

## 数据类型

### 核心数据结构

```typescript
// 文本块 - 切分后的原始文本单元
TextChunk {
  index: number
  content: string
  tokenCount: number
  startChar: number
  endChar: number
}

// 角色 - 全局档案
Character {
  id: string           // 如 CHAR_001
  name: string         // 规范化姓名
  aliases: string[]    // 别名/称呼
  description: string  // 详细描述
  importance: "major" | "minor" | "extra"
  visualTraits?: string // 视觉特征指令（英文）
}

// 事件 - 剧情单元
Event {
  id: string           // 如 E001
  summary: string      // 一句话摘要
  description: string  // 详细描述（含原文引用）
  chapter: string      // 所在章节
  location?: string    // 地点
  time?: string        // 时间
  characters: string[] // 涉及角色 ID
  emotionalTone: string // 情感基调
}

// 场景 - 漫剧最小逻辑单元
Scene {
  id: string
  title: string
  setting: string      // 地点、时间、氛围
  characters: string[] // 出场角色 ID
  dialogues: Dialogue[]
  narration?: string   // 旁白
  visualDescription: string // 视觉基调
}

// 镜头 - 漫剧最小物理单元
Shot {
  id: string
  type: "close-up" | "medium" | "wide" | "action" | "POV" | "over-the-shoulder"
  content: string      // 镜头内容
  imagePrompt: string  // AI 绘图 Prompt（英文）
  dialogueRef?: string // 对应台词
  duration: number     // 预估秒数
  audioCues: AudioCue[] // 音效/背景音
}

// 剧集
Episode {
  number: number
  title: string
  synopsis: string     // 剧集梗概
  scenes: Scene[]
}
```

## 使用方式

### 完整流程（Demo）

```bash
# 1. 设置环境变量
export ARK_API_KEY="your-volcengine-api-key"
# 或
export OPENAI_API_KEY="your-openai-api-key"
# 或
export DEEPSEEK_API_KEY="your-deepseek-api-key"

# 2. 运行 Demo
bun run src/demo.ts

# 只切块不调用 LLM
bun run src/demo.ts --chunks-only

# 只分析前 N 个块
bun run src/demo.ts --max-chunks=5
```

### 程序化使用

```typescript
import { 
  TokenChunker, 
  LLMClient, 
  NovelAnalyzer,
  mergeAnalyses 
} from "@workspace/novel-processor"

// 1. 切块
const chunker = new TokenChunker(8000, 500)
const chunks = chunker.chunk(novelText)

// 2. 分析
const llm = new LLMClient({ provider: "deepseek" })
const analyzer = new NovelAnalyzer(llm)

const { analyses, globalCharacters } = await analyzer.analyzeChunks(chunks, {
  limit: 10,
  concurrency: 5,
  onProgress: (stage, current, total) => {
    console.log(`${stage}: ${current}/${total}`)
  }
})

// 3. 合并结果
const merged = mergeAnalyses(analyses, globalCharacters)

// 4. 角色视觉设计
import { CharacterDesigner } from "@workspace/novel-processor"
const designer = new CharacterDesigner(llm)
const visualBible = await designer.designBatch(
  Array.from(merged.allCharacters.values())
)

// 5. 生成剧本
import { NovelRewriter } from "@workspace/novel-processor"
const rewriter = new NovelRewriter(llm)
const episodes = await rewriter.convertToSeries({
  totalSummary: merged.fullSummary,
  events: merged.allEvents,
  characters: visualBible,
  relations: merged.allRelations
})

// 6. 生成分镜
import { NovelDirector } from "@workspace/novel-processor"
const director = new NovelDirector(llm)
for (const ep of episodes) {
  for (const scene of ep.scenes) {
    const shots = await director.createStoryboard(scene, visualBible)
    console.log(`Scene ${scene.title}: ${shots.length} shots`)
  }
}
```

## 模块关系图

```
┌────────────────────────────────────────────────────────────────┐
│                        模块依赖关系                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   libs/                                                        │
│   ├── chunker.ts ──────┐                                       │
│   ├── llm.ts ──────────┼───────┬───────┬───────┐              │
│   └── logger.ts ───────┘       │       │       │              │
│                                ▼       ▼       ▼              │
│   modules/                 analyzer  designer  rewriter        │
│   ├── analyzer.ts              │               │               │
│   ├── designer.ts              │               │               │
│   ├── rewriter.ts              └───────────────┘               │
│   └── director.ts ─────────────────────────────┘               │
│                                                                │
│   types.ts ◄──────────────────────────────────────── All       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## 技术亮点

| 技术点 | 说明 |
|--------|------|
| **Sliding Window** | 分析时分片间传递摘要，保持长文本连贯性 |
| **HAR (Hallucination-Aware Refinement)** | 两轮 LLM 调用，自动纠正与原文不符的幻觉内容 |
| **Entity Resolution** | GraphRAG 思路，将散落角色描述合并为统一档案 |
| **Ghost Context** | 并行生成场景时，用大纲计划代替真实上文保持连贯 |
| **Visual Bible** | 为每个角色生成固定视觉指令，确保 AI 绘图一致性 |
| **Structured Output** | 全程使用 Zod Schema 约束 LLM 输出，类型安全 |

## 输出示例

运行 Demo 后，在 `output/` 目录下生成：

```
output/
└── 2026-01-28T11-30/
    ├── chunk_0.txt              # 切分后的文本块
    ├── chunk_1.txt
    ├── chunk_2.txt
    ├── chunk_0_analysis.json    # 分片分析结果（缓存）
    ├── chunk_1_analysis.json
    ├── chunk_2_analysis.json
    └── production_bundle_2026-01-28T11-30-45.json  # 最终产物
```

### 最终产物结构

```json
[
  {
    "number": 1,
    "title": "山村少年",
    "synopsis": "韩立在山村中的平凡生活...",
    "scenes": [
      {
        "id": "S001",
        "title": "村口相遇",
        "setting": "山村村口，清晨，薄雾",
        "characters": ["CHAR_001"],
        "dialogues": [...],
        "shots": [
          {
            "id": "SHOT_001",
            "type": "wide",
            "content": "山村全景，薄雾笼罩",
            "imagePrompt": "Ancient Chinese village at dawn...",
            "duration": 5
          }
        ]
      }
    ]
  }
]
```

## 配置说明

### LLM 提供商配置

支持三种 LLM 提供商：

| 提供商 | 环境变量 | 默认模型 |
|--------|----------|----------|
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` |
| 火山引擎 | `ARK_API_KEY` | `doubao-seed-1-8-251228` |

### 高级配置

```typescript
// 自定义模型参数
const llm = new LLMClient({
  provider: "volcengine",
  apiKey: "your-key",
  model: "custom-model-name"
})

// 调整切块参数
const chunker = new TokenChunker(
  12000,  // maxTokens: 每块最大 Token 数
  800     // overlapTokens: 块间重叠 Token 数
)
```

## 参考资料

- R2: Reward-Rewrite 论文思想
- GraphRAG: 实体消解参考
- Vercel AI SDK v4: 结构化输出实现
