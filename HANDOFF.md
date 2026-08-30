# SpeakLoop 项目交接文档

> 这份文档是从跟 Claude（claude.ai 网页版）的对话中整理出来的，目的是让 Claude Code 快速接手后续开发，不用重新问一遍背景。项目代码在 `projects/` 目录下。

## 项目是什么

**SpeakLoop** —— 一个雅思（IELTS）口语 Part 3 模拟面试 Web 应用。

- 技术栈：Next.js 16 (App Router) + React 19 + TypeScript + shadcn/ui + Tailwind CSS v4
- 包管理器：**必须用 pnpm**，项目配置了 `preinstall` 脚本会拒绝 npm/yarn
- 由"扣子编程"（Coze Coding，字节跳动的 AI 建站工具）生成初版脚手架，后续由 Claude（网页对话）持续迭代
- 部署预览目前在 Coze 平台上，用户本人不完全信任 Coze 的代码生成质量，所以把核心开发工作转移到 Claude 网页对话 + 现在准备转给 Claude Code

## 产品流程（6个页面）

```
/            Landing 首页
/examiner    选择 AI 考官（48个虚构考官档案，见下方数据结构）
/interview   模拟面试：3道主问题 + 3道追问，录音 → 后端STT转写
/evaluation  评分详情：显示雅思四项评分 + 逐题问答回顾 + AI改进建议
/practice    针对性练习：3道新题，同样录音+STT（但界面不显示转写文本，只留作后续对比证据）
/final-evaluation  最终对比：interview前 vs practice后 的分数对比 + AI分析进步点
```

会话状态（考官选择、每题录音转写文本）存在 `src/lib/store/interview-session.ts`，用 localStorage 持久化，模块级单例变量，靠客户端路由跳转保持数据不丢。

## 本次对话里已经做完的事（按顺序）

1. **修了按钮吸底问题**：`interview/page.tsx`、`practice/page.tsx` 里原来"Finish Answer"等按钮跟在视频下面，宽屏/矮屏需要滚动才能点到。改成 `position: fixed; bottom: 0` 的吸底操作栏，视频尺寸完全没变。

2. **接入真实后端 STT，修复"整题丢失"的根本 bug**：原来两个页面都只依赖浏览器自带的 `webkitSpeechRecognition`（不稳定、Safari 支持差），而且有个致命 bug——如果某题识别结果是空字符串，那道题会被**整个跳过不存**，导致 evaluation 页面题目编号错位、显示不全。现在改成：MediaRecorder 录音 → 上传到 `/api/stt` 后端接口做真实转写 → **不管转写成功与否都一定会存一条记录**（失败就存占位文字），从根源上防止题目丢失。

3. **practice 页面补上了真实录音**：之前这个页面压根没有 MediaRecorder，只是问了一下麦克风权限就扔了。现在跟 interview 页面一样接入真实录音 + STT，但转写文本**不在 practice 界面显示**，只存起来给 final-evaluation 页面当作"进步对比"的证据用。

4. **修复 Safari 兼容性**：MediaRecorder 之前写死录成 `audio/webm` 格式，但 **Safari 根本录不出 webm**（只支持 mp4/aac）。现在改成动态侦测浏览器实际支持的格式（`MediaRecorder.isTypeSupported()`），录成什么格式就按什么格式上传、按什么格式转发给转写 API。

5. **STT 和 AI 分析都接入了 Groq（免费额度优先，省钱）**：
   - `/api/stt/route.ts`：优先读 `GROQ_API_KEY`（Groq 的 Whisper 转写免费额度：2000次/天、约8小时音频/天，模型名 `whisper-large-v3-turbo`），没配才退回 `OPENAI_API_KEY`（模型 `whisper-1`），都没配就返回 mock 假数据（开发期兜底）。
   - `/api/analyze-progress/route.ts`（新建）：final-evaluation 页面"Your Progress"板块原来是纯关键词规则匹配，现在改成真的调用 LLM 分析（同样优先 Groq `openai/gpt-oss-20b`，没配退回 OpenAI `gpt-4o-mini`，都没配则规则匹配兜底）。
   - **重要**：Groq 免费档不需要绑卡，超额度只会返回 429 限流报错，不会产生任何账单，用户对这点很在意（不想被意外扣费）。

6. **修了一个刚发现的报错吞掉的 bug**：之前不管 STT 请求失败的真实原因是什么（认证错误/格式错误/网络问题……），前端都统一显示成"No speech detected"，掩盖了真实报错。现在改成失败时把真实错误信息（HTTP状态码 + 后端返回的 error 字段）显示出来，方便调试。**用户当前正在用这个新版本排查"配置了 GROQ_API_KEY 但还是显示 No speech detected"的问题**，可能是 Groq 对单次请求音频时长有最低要求（约10秒），也可能是环境变量没有重新部署生效，需要看实际报错信息才能确认。

## 待办事项（接下来要做的）

### 优先级最高：评分是完全假的
`evaluation/page.tsx` 里的四项评分（Fluency/Lexical/Grammar/Pronunciation）来自 `src/lib/mock/data.ts` 里硬编码的 `mockEvaluation` 对象，**不管学生说了什么，分数永远一样**。"Improved version" 那段文字也是写死的占位符，不是基于学生真实回答生成的。这是产品的核心价值所在，目前完全没做，建议第一优先级补上：把 STT 转写文本喂给 LLM，按雅思真实评分标准（band descriptor）打分 + 给出证据 + 生成真正针对该学生回答的改进版本。

### 当前正在做：静态考官肖像（本次交接的直接目的）
用户希望 `/examiner` 选择页 + interview/practice 视频区，把现在的灰色人形图标换成**真实照片质感**（不要插画/卡通风格）的考官头像，根据每个考官的 `nationality/gender/ethnicity/personality` 生成对应的肖像。

- 考官数据结构在 `src/lib/mock/data.ts` 的 `examiners` 数组，共 **48 条**（4国籍 × 2性别 × 6种 personality/difficulty 组合）
- 推荐用 **Google Gemini 图片生成 API（Nano Banana）**：免费额度、不用绑卡、生成的是照片写实风格，符合 `DESIGN.md` 里"避免插画/卡通"的要求。去 https://aistudio.google.com 免费注册拿 API Key
- 本交接包里附带了 `scripts/generate-portrait-prompts.js`，**直接从 `data.ts` 源文件解析数据**（没有手抄，避免数据不同步），运行 `node scripts/generate-portrait-prompts.js --json` 会输出 48 条已经拼好的生成 prompt（JSON格式，含 id、目标存放路径、prompt文本），可以直接喂给图片生成 API 批量跑，已经在本地验证过能正确运行
- 生成好图片后，需要：
  1. 把图存到 `public/examiners/{id}.jpg`（脚本输出里已经给好了每条对应的 `outputPath`）
  2. `Examiner` 接口（`src/lib/mock/data.ts`）加一个 `avatarUrl` 字段
  3. `examiner/page.tsx` 的考官卡片、`interview/page.tsx` 和 `practice/page.tsx` 的视频占位区，把现在的 SVG 人形图标换成对应的 `<img>` 或 Next.js `<Image>` 组件

### 之后要做：personality/difficulty 真正影响面试内容
现在虽然 96 个考官档案都有 `personality`（Strict/Friendly/Encouraging/Challenging）和 `difficulty`（Easy/Standard/Challenging）字段，但**完全是摆设**——不管选哪个考官，`interview/page.tsx` 里问的都是同一份写死的 3 道题（`mockQuestions` 数组），追问也是固定的。用户希望这两个字段真正驱动：
- 根据 difficulty 动态生成/筛选题目难度（而不是写死数组）
- 追问根据学生刚才的真实回答，由 LLM 现场生成
- 语气/口吻根据 personality 调整 system prompt（Strict 更严谨挑剔，Friendly 更鼓励）
- 如果之后做 TTS，音色也可以按 personality 挑选

### 更远期、用户认为优先级较低的：
- 用户提到自己是要做 **AI+教育岗位的求职作品集**，希望展示 Vibe Coding / API调用 / 多模态 / Skill / RAG / Workflow / MCP 这些能力。已经跟他过了一遍哪些值得做、哪些不值得：
  - **RAG 最值得补**：题库和雅思评分标准（band descriptor）都应该存进向量库做检索，而不是写死在 prompt 里。项目依赖里已经有 `@supabase/supabase-js`（自带 pgvector），基础设施已经在，只是没用。
  - **Skill**：建议把评分/追问逻辑整理成一份结构化的 Skill 文档，可复用、可讲故事
  - **Workflow**：可以考虑用 Coze 平台自带的可视化 Workflow 功能把评分那一步单独拎出来
  - **MCP**：不建议往 SpeakLoop 本体里硬塞，建议单独写一个小的 MCP server（比如"查询学生历史评分"、"生成指定难度雅思题"）作为独立配件展示
  - **动态数字人视频形象**（用户最初的多模态设想）：技术上可行（HeyGen/D-ID/Tavus等），但成本高（约 $0.03–0.20/分钟）、复杂度高，性价比对求职展示来说不如把评分/RAG做扎实，建议先不做，只做静态肖像

## 已知的技术债 / 需要注意的坑

- **没有任何登录/限流保护**：`/api/stt` 和 `/api/analyze-progress` 任何人都能无限调用，如果网站公开发布给不特定人群，Groq 免费额度会被轻易刷爆，建议后续加基础的 rate limiting
- **题库只有 3+3 道题，太少**：实际使用需要大幅扩充
- **`OPENAI_API_KEY` / `GROQ_API_KEY` 都是后端环境变量**，前端代码完全不接触，访客不需要、也看不到这些 key——这个之前跟用户确认过，他一开始有误解以为要访客自己填 key
- 项目在 Coze 平台改环境变量后，**可能需要重新部署/重启才生效**，之前排查 STT 问题时怀疑过这个原因

## 关于 Claude（网页对话）的工具限制（供 Claude Code 了解背景）

之前跟用户的对话是在 claude.ai 网页版进行的，那个环境**没有联网权限**，无法执行 `pnpm install`、起本地开发服务器、也没有图片生成工具，所以：
- 所有代码修改都是人工审查（没有实际跑起来验证过，逻辑和语法是逐字核对的，但没有真机测试）
- 静态肖像这个任务做不了（没有图片生成能力），这也是为什么要交接给 Claude Code
- 用户如果发现代码有实际运行时的问题，麻烦重点检查一下（尤其是异步逻辑、React state 更新时序这些纯靠人工审查容易漏的地方）
