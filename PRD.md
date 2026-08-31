# SpeakLoop PRD v3

基于 2026-08-31 最新产品讨论、当前项目代码状态与百炼当前模型能力矩阵

# 1. 产品一句话定义

SpeakLoop 是一个基于 IELTS Speaking 题库与 AI Examiner Persona 的 AI 口语模拟面试 Web App。系统从 RAG 题库选择主问题，学生通过麦克风回答，专用 ASR 转录回答，主 LLM 根据真实回答生成动态 follow-up，并在面试结束后依据 IELTS Speaking rubric 给出结构化评分、证据、改进建议与针对性练习，最终形成 Assessment → Practice → Re-assessment → Progress 的闭环。

# 2. 最新核心架构结论

|能力|模型/实现|当前是否使用|
|---|---|---|
|STT|Qwen3-ASR-Flash|✅|
|主 LLM|qwen3.5-flash|✅|
|RAG|题库 + IELTS rubric；Supabase/pgvector 或 Coze Knowledge Base|✅|
|TTS|暂不实现|❌|
|Realtime Voice|暂不实现|❌|
|Omni|qwen3.5-omni-flash 暂不进入核心链路；未来用于音频级分析/语音交互探索|❌ 当前|
|API Key|单一 DASHSCOPE_API_KEY|✅|

模型选型依据：百炼当前文档显示 qwen3.5-flash 在华北2（北京）支持 Function Calling、结构化输出、上下文缓存等能力；qwen3-asr-flash 专注 Audio → Text；qwen3.5-omni-flash 虽支持 Audio 输入/Audio 输出，但当前华北2能力页显示 Function Calling 与结构化输出均不支持，因此不适合作为本项目唯一主 LLM。

# 3. 当前项目真实完成度

|模块|当前状态|下一步|
|---|---|---|
|Home / Examiner|基础 UI 与 examiner 档案已完成|让 personality/difficulty 真正进入 AI context|
|Interview|录音、Safari MIME 兼容、后台 STT、session 持久化基础已完成|迁移 STT；RAG 主问题；动态 follow-up|
|STT|/api/stt 仍使用讯飞 AST，缺 Key 时有 mock|迁移 Qwen3-ASR-Flash|
|Evaluation|页面/UI/逐题 transcript 展示已存在|删除 mockEvaluation，接 qwen3.5-flash|
|Practice|录音 + STT + transcript 基础链路存在|从 evaluation weakness 驱动 RAG 练习|
|Final Evaluation|页面与 before/after 展示存在|改为真实 evaluation + progress analysis|
|RAG|Supabase 依赖存在，但尚未形成完整题库检索链路|建立 question/rubric retrieval|
|LLM|部分能力仍直接依赖智谱/mock|统一到 qwen3.5-flash|

# 4. 目标用户流程

1. 用户进入 SpeakLoop，选择 AI Examiner。
2. 系统读取 examiner 的 personality 与 difficulty。
3. 根据 IELTS Part、difficulty、topic/session context，从 RAG 题库检索候选题。
4. qwen3.5-flash 依据候选题与考试规则选择/编排主问题。
5. 问题以文字显示；当前 MVP 不需要 TTS。
6. 学生录音回答；后端将音频交给 Qwen3-ASR-Flash，得到 transcript。
7. qwen3.5-flash 读取 question + transcript + examiner context + interview history，生成一个自然、相关且难度合适的 follow-up。
8. 学生继续回答；所有 question/answer/follow-up 持久化。
9. 面试结束，qwen3.5-flash 根据 IELTS rubric 生成结构化评分、证据、弱点、改进建议和 improved sample answer。
10. Practice 根据 weakness 从 RAG 检索新题，避免重复。
11. Practice 完成后再次 evaluation。
12. Final Evaluation 比较两次真实 evaluation，给出有证据的进步分析。

# 5. AI 架构与职责边界

核心原则：一个供应商、一个 API Key、多个职责明确的模型/服务。不要追求"一个模型包办一切"。

DASHSCOPE_API_KEY → Qwen3-ASR-Flash（Audio→Text） + qwen3.5-flash（Text→Structured AI decisions）。RAG 由应用检索层/Coze 知识库提供 context；主 LLM 消费检索结果。

## 5.1 Qwen3-ASR-Flash

- 唯一职责：学生回答语音转 transcript。
- 不负责评分、不负责 follow-up、不负责结构化分析。

## 5.2 qwen3.5-flash

- 主 LLM，负责 question selection、follow-up、evaluation、feedback、practice recommendation、progress analysis。
- 使用 Structured Output 保证 API contract 稳定。
- 必要时使用 Function Calling 调用 retrieval/service tools。

## 5.3 Qwen3.5-Omni-Flash

- 当前不作为主 LLM。
- 未来如果产品需要真实语音考官或更可靠的音频层 pronunciation analysis，再单独评估。

# 6. RAG 产品逻辑

- RAG 决定"题库里有哪些合法/合适的题"，LLM 决定"本次该问哪一道、如何组织"。
- 主问题优先来自题库，不允许生产路径完全依赖 LLM 无约束自创题。
- Follow-up 不要求预存在题库中；它由 qwen3.5-flash 根据学生刚才的真实回答动态生成。
- Practice 优先检索与首次 evaluation weakness 对应的题目。
- 每个 retrieval result 带 question_id/source/topic/difficulty 等 metadata。
- IELTS rubric 单独作为知识库/数据源，不能与题库混为一谈。

# 7. Examiner Persona

|字段|控制内容|不应控制|
|---|---|---|
|personality|语气、互动方式、追问风格|IELTS scoring标准|
|difficulty|题目复杂度、抽象程度、follow-up 深度|Band score规则|
|gender / ethnicity|视觉角色展示|评分|
|nationality|角色上下文/语言风格|评分|

Personality 与 difficulty 必须集中配置，不能散落在多个页面写 if/else。

# 8. Evaluation 设计

|Criterion|必须输出|
|---|---|
|Fluency & Coherence|band + evidence + rationale|
|Lexical Resource|band + evidence + rationale|
|Grammatical Range & Accuracy|band + evidence + rationale|
|Pronunciation|仅在有可靠音频证据时进行音频层判断；仅 transcript 时不得伪造|
|Overall|overall band + 综合理由|
|Feedback|main weakness + improvement focus + improved sample answer|

所有 Evaluation API 返回严格结构化 JSON；前端只消费 schema，不解析自然语言。

# 9. 当前明确不做

- TTS。
- Realtime WebSocket voice。
- 数字人/口型。
- 为了 Function Calling 而强行使用 Omni。
- 生产级账户体系，除非核心闭环已经稳定。
- 让 mock score/mock question 继续进入 production path。

# 10. MVP 成功标准

- 讯飞与智谱不再是生产路径依赖。
- 一个 DASHSCOPE_API_KEY 能完成真实 STT + 主 LLM 链路。
- 主问题来自 RAG；follow-up 根据学生真实回答动态生成。
- Evaluation 不再依赖 mock 分数。
- Practice 能针对 weakness 选择新题。
- Final Evaluation 使用真实 before/after 数据。
- personality/difficulty 可观察地影响提问，但不影响评分规则。
- 所有 AI API 都有 schema、timeout、error/retry 与可追踪 session。

# 11. 后续升级路线

- 阶段2：TTS，让 examiner 文字问题变成语音。
- 阶段3：Realtime Voice，让 examiner 成为真正的语音对话 agent。
- 阶段4：Omni 音频级分析，用于 pronunciation / prosody 等更深层能力。
- 阶段5：Coze Skill/Workflow/MCP 作为可展示的 AI engineering layer。
