# SpeakLoop 开发完成计划 v3

最新模型方案：Qwen3-ASR-Flash + qwen3.5-flash + RAG；单一 DASHSCOPE_API_KEY

# 执行原则

- 第一步不是直接删代码，而是建立百炼统一 Provider → 迁移 → 验证 → 删除旧供应商。
- 长期生产架构：讯飞 STT → Qwen3-ASR-Flash；智谱 LLM → qwen3.5-flash。
- 一个 DASHSCOPE_API_KEY，不等于只能使用一个 model ID。
- 当前不做 TTS/realtime；不要让 Claude Code 为此引入额外复杂度。
- Claude Code 主导代码；Coze 主导适合知识库/Workflow/Skill 的部分；不要让两个工具同时修改同一核心文件。
- 每步完成必须运行 pnpm ts-check、pnpm lint:build、pnpm lint:style，并手测相关路径。

# 第一步：统一 AI Provider，迁移讯飞 STT + 智谱 LLM

- 盘点 XFYUN/ZHIPU/GROQ/OPENAI 引用和环境变量。
- 建立 server-only AI provider。
- /api/stt → Qwen3-ASR-Flash。
- /api/analyze-progress → qwen3.5-flash。
- 先保留旧 provider 作为可回滚分支，验证后再删除。
- 清理讯飞专用 PCM 逻辑，但保留 Safari MediaRecorder 必要的 MIME 兼容。
- 统一错误结构、timeout、retry。

# 第二步：把 IELTS Evaluation 从 mock 迁移到 qwen3.5-flash

- 建立 /api/evaluate-interview。
- 输入 question-answer pairs + examiner context + rubric context。
- 使用 structured output。
- 四项评分 + evidence + rationale + overall + weakness + improved answer。
- Pronunciation 严格区分 transcript evidence 与 audio evidence。
- 删除 mockEvaluation production dependency。

# 第三步：建立真实 RAG 题库 + IELTS Rubric

- 设计 questions 与 rubrics schema。
- 建立 Part 1/2/3 数据，先保证 Part 3 高质量。
- 按 part/topic/difficulty/tags/source 检索。
- rubric 单独管理。
- 返回 metadata。
- 可选 Supabase/pgvector 或 Coze Knowledge Base，但必须有明确 retrieval contract。

# 第四步：RAG 驱动主问题

- 删除 interview 主流程对 mockQuestions 的依赖。
- 开始 session 时按 Part/difficulty/topic 检索候选。
- qwen3.5-flash 选择/编排主问题。
- 问题保存进 session。
- 失败时明确报错，不随机跳题。

# 第五步：AI 动态 Follow-up

- Follow-up 不需要在 RAG 里预存。
- 读取当前 question + transcript + history + personality + difficulty。
- 一次生成一个 follow-up。
- 输出 intent + question + rationale。
- 确保问题真正回应学生内容。

# 第六步：Personality / Difficulty 真正生效

- 集中管理 persona config。
- 测试至少 4 personality × 3 difficulty。
- 保证 personality 影响 wording/interaction；difficulty 影响 complexity/depth。
- 评分 rubric 完全独立。

# 第七步：Targeted Practice

- 读取第一次 evaluation weakness。
- RAG 检索针对性新题。
- 排除已经使用的 question_id。
- Practice 保存真实 transcript。
- 完成后进入第二次 evaluation。

# 第八步：真实 Final Evaluation + Progress

- before score = first evaluation。
- after score = practice evaluation。
- progress analysis = qwen3.5-flash。
- 输出有证据的 improvement。
- 无证据时明确说明，不能制造进步。
- 删除 mockBeforeScores/mockAfterScores。

# 第九步：Coze Knowledge Base / Skill / Workflow

- 把题库、rubric、follow-up rules、evaluation rules 整理为可展示 AI engineering layer。
- Coze 不重复实现 Next.js provider。
- 明确唯一 source of truth。
- 输出可复用 Skill 文档。

# 第十步：Production Readiness

- 删除 production path 的 mock fallback。
- API key server-only。
- 限流、timeout、retry。
- 音频大小/时长校验。
- 统一 request ID/logging。
- JSON schema validation。
- 重复题防止。
- 成本监控与错误监控。

# Coze 与 Claude Code 分工

|工具|主要职责|不要做什么|
|---|---|---|
|Claude Code|Next.js、API routes、provider、session、RAG service、UI integration、tests|不要把核心业务逻辑重复搬进 Coze|
|Coze|Knowledge Base、Workflow、Skill、Agent orchestration 的可视化实现|不要直接与 Claude Code 同时改同一核心代码|

# 里程碑

|里程碑|完成标准|
|---|---|
|M1 Provider Migration|Qwen3-ASR-Flash + qwen3.5-flash 可用；讯飞/智谱退出生产路径|
|M2 Real Evaluation|真实 transcript → structured IELTS evaluation|
|M3 RAG|真实题库/rubric retrieval|
|M4 AI Interview|RAG 主问题 + 动态 follow-up|
|M5 Persona|personality/difficulty 有可观察效果|
|M6 Practice|weakness-driven practice|
|M7 Progress|真实 before/after evaluation|
|M8 Coze|Knowledge/Workflow/Skill 整理|
|M9 Production|错误、成本、限流、测试完成|
