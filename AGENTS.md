# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## SpeakLoop 项目结构

### 页面路由

| 路由 | 文件 | 功能 |
|------|------|------|
| `/` | `src/app/page.tsx` | Landing 首页 |
| `/examiner` | `src/app/examiner/page.tsx` | 选择 AI 考官 |
| `/interview` | `src/app/interview/page.tsx` | 模拟面试 |
| `/evaluation` | `src/app/evaluation/page.tsx` | 评分详情 |
| `/practice` | `src/app/practice/page.tsx` | 个性化练习 |
| `/final-evaluation` | `src/app/final-evaluation/page.tsx` | 最终评估对比 |

### 关键文件

- `PRD.md` — 产品需求文档 v3（架构、模型选型、用户流程、Evaluation 设计）
- `DEV_PLAN.md` — 开发完成计划 v3（10 步执行路径、里程碑 M1-M9）
- `AI_ENGINEERING.md` — AI 工程层文档（RAG 契约、Prompt 设计、评估流水线）
- `src/lib/ai/provider.ts` — 统一 AI Provider（DashScope: Qwen3-ASR-Flash + qwen3.5-flash）
- `src/lib/rag/retrieval.ts` — RAG 检索服务（metadata 过滤）
- `src/data/questions.json` — 雅思题库（1014 道 Part 3 题目）
- `src/data/rubric.ts` — 官方 IELTS Speaking Band Descriptors
- `src/lib/mock/data.ts` — Mock 数据（考官人设、fallback 数据）
- `src/components/step-indicator.tsx` — 步骤导航指示器
- `DESIGN.md` — 设计规范（配色、字体、动效）
- `HANDOFF.md` — 项目交接文档（背景、已完成事项、技术债）

### API 路由

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/stt` | POST | 语音转文字（Qwen3-ASR-Flash） |
| `/api/interview-questions` | POST | RAG + LLM 生成面试问题 |
| `/api/follow-up` | POST | 根据回答生成追问 |
| `/api/evaluate-interview` | POST | IELTS 结构化评分 |
| `/api/practice-questions` | POST | 基于弱项生成练习题 |
| `/api/final-evaluation` | POST | 前后对比评估 |
| `/api/analyze-progress` | POST | 进步分析 |
| `/api/questions` | GET | 题库查询（统计/话题/检索） |
