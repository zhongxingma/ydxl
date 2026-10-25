# 项目全面技术分析与优化报告

> **历史归档**：本文为 2026-07-27 的分析快照，内容不随代码更新，仅供追溯。当前架构与约束请以 `docs/ARCHITECTURE.md`、`docs/SECURITY`、`SECURITY.md` 为准。

> 生成日期：2026-07-27
> 分析范围：ydxl 英语学习 PWA 项目全量源码、文档、配置、依赖
> 执行人：AI 辅助自动化分析

---

## 目录

- [1. 执行摘要](#1-执行摘要)
- [2. 问题清单与修复记录](#2-问题清单与修复记录)
- [3. 代码质量检查](#3-代码质量检查)
- [4. 功能模块评估](#4-功能模块评估)
- [5. 功能逻辑验证](#5-功能逻辑验证)
- [6. 文档完整性检查](#6-文档完整性检查)
- [7. 安全审计](#7-安全审计)
- [8. 项目垃圾清理](#8-项目垃圾清理)
- [9. 验证结果](#9-验证结果)
- [10. 后续建议](#10-后续建议)

---

## 1. 执行摘要

本次对 ydxl 项目进行了全面深入的技术分析与优化，覆盖代码质量、功能模块、业务逻辑、文档完整性、安全审计、项目垃圾清理六大维度。

### 关键成果

| 维度 | 发现问题 | 已修复 | 遗留 |
| --- | --- | --- | --- |
| 安全漏洞 | 6 项（P0×1, P1×3, P2×2） | 6 项 | 0 |
| 代码缺陷 | 3 项 | 3 项 | 0 |
| 文档不一致 | 15+ 项 | 15+ 项 | 0 |
| 项目垃圾 | 3 项 | 3 项 | 0 |
| 测试缺失 | 3 项 | 3 项 | 0 |

### 验证状态

- ✅ 前端类型检查：零错误
- ✅ 前端构建：796 模块，8.41s
- ✅ 前端测试：523 通过（42 文件）
- ✅ 服务端构建：零错误
- ✅ 服务端测试：152 通过（12 文件）

---

## 2. 问题清单与修复记录

### 2.1 P0 级（严重安全漏洞）

| # | 问题 | 根因 | 修复方案 | 涉及文件 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | **API 密钥泄露至前端 bundle** | `.env` 中 `VITE_DEEPSEEK_API_KEY` 包含真实密钥，Vite 打包时注入前端 bundle，用户可在浏览器 DevTools 中查看 | 清空 `VITE_DEEPSEEK_API_KEY`，密钥仅保留在服务端 `DEEPSEEK_API_KEY` 变量 | `.env` | ✅ 已修复 |

### 2.2 P1 级（重要安全隐患）

| # | 问题 | 根因 | 修复方案 | 涉及文件 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 2 | **AI 代理无独立限流** | AI 代理端点与其他 API 共用 60 次/分钟限流，可被滥用消耗 DeepSeek 配额 | 为 `/api/v1/ai-proxy` 添加独立限流（20 次/分钟/IP） | `server/src/index.ts` | ✅ 已修复 |
| 3 | **请求体校验过弱** | 仅校验 body 存在性，未限制 model 和 max_tokens，存在恶意请求风险（超大 max_tokens 触发计费、非法 model） | 新增 `validateUpstreamBody` 函数：model 白名单、max_tokens 上限 4096、messages 非空数组校验 | `server/src/ai-proxy.ts` | ✅ 已修复 |
| 4 | **生产环境加密密钥风险** | 生产环境未配置 `ENCRYPTION_KEY` 时使用随机临时密钥，重启后无法解密旧数据 | 改为 fail-fast 拒绝启动，强制配置密钥 | `server/src/encryption.ts` | ✅ 已修复 |

### 2.3 P2 级（依赖与文档）

| # | 问题 | 根因 | 修复方案 | 涉及文件 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 5 | **react-router-dom 安全漏洞** | 使用 6.27.0 版本存在 CVE-2025-68470 等漏洞 | 升级至 6.30.4 | `package.json` | ✅ 已修复 |
| 6 | **文档与代码大面积不一致** | API_REFERENCE.md 中模型名（deepseek-chat）、超时值（30s/8s）、接口定义等与代码实现不符 | 全量更新文档：模型名→deepseek-v4-pro、超时→60s/45s、接口补充 streamOptions/enrichSingleWord | `docs/API_REFERENCE.md` | ✅ 已修复 |

### 2.4 代码缺陷

| # | 问题 | 根因 | 修复方案 | 涉及文件 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 7 | **超时错误消息与实际阈值不符** | 错误消息写死"请求超时（30s）"，但代码实际超时阈值为 60s | 更新错误消息为"请求超时（60s）" | `src/shared/services/ai/baseProvider.ts` | ✅ 已修复 |
| 8 | **encryption.ts 未用常量** | 移除临时密钥生成逻辑后 `KEY_LENGTH` 变为死代码，触发 TS6133 编译错误 | 移除未用常量，保留注释说明 | `server/src/encryption.ts` | ✅ 已修复 |
| 9 | **aiProxy 测试用例与新校验逻辑冲突** | 新增 `validateUpstreamBody` 后，8 个测试用例发送的 `messages: []` 被正确拒绝，测试失败 | 更新测试用例使用合法 messages 数组，新增 3 个校验规则测试 | `server/src/__tests__/aiProxy.test.ts` | ✅ 已修复 |

### 2.5 项目垃圾

| # | 问题 | 修复方案 | 状态 |
| --- | --- | --- | --- |
| 10 | 空的 `api/` 目录（迁移至 server/src 后的残留） | 删除目录 | ✅ 已清理 |
| 11 | `server/tsconfig.tsbuildinfo` 未被 .gitignore 忽略 | 添加 `*.tsbuildinfo` 到 .gitignore | ✅ 已修复 |
| 12 | `.env` / `.env.example` 注释描述与代码行为不符（加密/CORS） | 同步更新注释 | ✅ 已修复 |

---

## 3. 代码质量检查

### 3.1 TypeScript 严格模式

- ✅ 前端与服务端均启用 TypeScript strict 模式（含 `noImplicitReturns`）
- ✅ 前端类型检查零错误
- ✅ 服务端构建（含类型检查）零错误

### 3.2 代码规范

- ✅ ESLint + Prettier 配置完整（`.eslintrc.cjs`、`.prettierrc`）
- ✅ Husky pre-commit 钩子 + lint-staged 自动修复
- ✅ 服务端 `console.log` 使用得当（仅用于启动消息与 seed 脚本，运行时日志使用 console.error/warn/debug）

### 3.3 错误处理

- ✅ Express 全局错误处理中间件：结构化 JSON 错误响应，生产环境错误信息脱敏
- ✅ AI 服务层错误传播链完整：AIError → 服务层 → UI 层（不静默吞错）
- ✅ 重试机制：前端指数退避（1s/2s，最多 2 次），后端独立重试（含 Retry-After 头支持）

### 3.4 性能

- ✅ 分层限流：全局 60/min + AI 代理独立 20/min
- ✅ AI 调用缓存：extractVocabulary 24h 缓存、generateQuestions 7 天缓存兜底
- ✅ 流式输出：长响应场景（article/questions）支持 SSE 流式 + AbortController 中断
- ✅ 数据库索引：contentHash、readAt 等关键字段已建索引

---

## 4. 功能模块评估

### 4.1 分层架构

```
前端 (src/)
├── features/          # 功能模块（reading/wordbook/review/stats/auth）
├── shared/            # 共享层
│   ├── components/    # 通用组件
│   ├── hooks/         # 自定义 Hooks
│   ├── services/      # 服务层（AI/Repository/localApi）
│   ├── types/         # 类型定义
│   └── utils/         # 工具函数
└── App.tsx

服务端 (server/src/)
├── index.ts           # Express 入口（CORS/限流/路由挂载）
├── routes.ts          # 7 张表 REST CRUD
├── ai-proxy.ts        # AI 代理（含流式 SSE）
├── encryption.ts      # AES-256-GCM 加密
└── db.ts              # SQLite 数据库
```

### 4.2 模块完整性

| 模块 | 设计合理性 | 实现完整性 | 接口一致性 | 评估 |
| --- | --- | --- | --- | --- |
| AI Provider 抽象层 | ✅ 模板方法模式，子类仅实现 5 个差异化方法 | ✅ 10 个公开方法全部实现 | ✅ 接口与文档一致 | 优秀 |
| Repository 数据层 | ✅ 三层架构（Local/Remote/CachedRemote） | ✅ 7 个 Repository 实例 | ✅ 类型定义与 SQLite 表一致 | 优秀 |
| AI 代理 | ✅ 信封/裸 body 兼容，流式 + 非流式 | ✅ 含 schema 校验、重试、超时 | ✅ 错误码与文档一致 | 优秀 |
| 加密模块 | ✅ AES-256-GCM，向后兼容明文迁移 | ✅ 加密/解密/测试钩子完整 | ✅ 生产强制配置 | 优秀 |

---

## 5. 功能逻辑验证

### 5.1 核心业务流程

| 流程 | 验证方式 | 结果 |
| --- | --- | --- |
| 每日文章生成 | AI Provider 测试 + 文章去重测试 | ✅ 含 avoidTopics 避免重复、contentHash 去重（3 次重试 + 历史回退） |
| 阅读理解题生成 | AI Provider 测试 | ✅ 流式输出 + AbortController 中断 |
| 生词本 AI 补全 | enrichSingleWord 测试 | ✅ maxTokens 1024（含 phrases 不截断） |
| SM-2 复习算法 | Review 模块测试 | ✅ 间隔梯度 1/2/4/7/15/30 天 |
| 离线缓存策略 | 集成测试 | ✅ 服务器优先 + Dexie 离线回退 |
| AI 代理转发 | 14 个端到端测试 | ✅ 含超时/重试/4xx/5xx/schema 校验 |

### 5.2 数据一致性

- ✅ 前端 Dexie 表与服务器 SQLite 表字段名完全一致（camelCase），无需映射转换
- ✅ JSON 字段自动序列化/反序列化（`JSON_COLUMNS` 定义）
- ✅ POST 端点使用 `INSERT OR REPLACE` 实现幂等性

---

## 6. 文档完整性检查

### 6.1 文档清单

| 文档 | 用途 | 时效性 | 准确性 |
| --- | --- | --- | --- |
| `API_REFERENCE.md` | API 参考手册 | ✅ 已更新 | ✅ 与代码一致 |
| `TECHNICAL_ANALYSIS.md` | 技术分析文档 | ✅ 已更新 | ✅ 与代码一致 |
| `ARCHITECTURE.md` | 架构设计 | ✅ | ✅ |
| `LINUX_DEPLOY.md` | Linux 部署指南 | ✅ | ✅ |
| `DEPLOYMENT.md` | 部署概览 | ✅ | ✅ |
| `AI_TOKEN_OPTIMIZATION.md` | Token 优化文档 | ✅ | ✅ |
| `CACHING.md` | 缓存策略 | ✅ | ✅ |
| `TESTING.md` | 测试指南 | ✅ | ✅ |
| `.env.example` | 环境变量示例 | ✅ 已更新 | ✅ 与代码一致 |

### 6.2 本次文档修复项

- API_REFERENCE.md：模型名 deepseek-chat → deepseek-v4-pro（全文 6 处）
- API_REFERENCE.md：超时值 30s/8s → 60s/45s（前端/后端）
- API_REFERENCE.md：AIProvider 接口补充 streamOptions / enrichSingleWord
- API_REFERENCE.md：新增分层限流文档（全局 60/min + AI 代理 20/min）
- API_REFERENCE.md：新增请求体 Schema 校验文档（model 白名单 / max_tokens 上限 / messages 非空）
- API_REFERENCE.md：CORS 默认行为更新（生产环境仅本机，非 `*`）
- API_REFERENCE.md：错误处理中间件补充生产环境脱敏说明
- .env / .env.example：加密注释更新（临时密钥 → fail-fast 拒绝启动）
- .env / .env.example：CORS 注释更新（未配置时行为按环境区分）

---

## 7. 安全审计

### 7.1 已修复漏洞

| 类别 | 漏洞 | 严重性 | 修复方案 |
| --- | --- | --- | --- |
| 密钥管理 | API 密钥泄露至前端 bundle | P0 | 前后端变量分离，密钥仅服务端 |
| 访问控制 | AI 代理无独立限流 | P1 | 独立限流 20/min/IP |
| 输入校验 | 请求体 schema 校验缺失 | P1 | model 白名单 + max_tokens 上限 + messages 非空 |
| 数据安全 | 生产环境加密密钥缺失风险 | P1 | fail-fast 拒绝启动 |
| 依赖安全 | react-router-dom CVE | P2 | 升级至 6.30.4 |
| 信息泄露 | 生产环境错误信息未脱敏 | P2 | 全局错误中间件生产环境返回通用消息 |

### 7.2 现有安全措施

- ✅ CORS 环境感知默认（生产仅本机，开发允许所有）
- ✅ AES-256-GCM 加密（敏感字段加密存储）
- ✅ SQL 参数化查询（防注入）
- ✅ 全局错误处理中间件（防 nginx 502，结构化 JSON 错误）
- ✅ .gitignore 正确配置（.env / dist / node_modules / tsbuildinfo）

### 7.3 残留风险（可接受）

| 风险 | 说明 | 缓解措施 |
| --- | --- | --- |
| 无鉴权 | 本地/局域网部署，不校验 token | 设计如此，多用户场景需自行扩展 |
| AI 代理鉴权（历史项，已解决） | 本报告写作时 `AI_PROXY_TOKEN` 为预留项；后续多用户改造已改为会话令牌 `x-user-token` + 按用户配额，`AI_PROXY_TOKEN` 已移除 | 登录认证 + 每用户 20 次/分钟限流 |

---

## 11. v3 深度审计（2026-07-27）

> 范围：在 v2 静态分析已清洁的基础上，聚焦运行时业务逻辑正确性、跨模块集成边界、并发与边缘场景、性能瓶颈实测等静态分析无法覆盖的深层问题。
> Spec 文档：`.trae/specs/audit-and-optimize-project-v3/`

### 11.1 v3 关键成果

| 维度 | 发现问题 | 已修复 | 遗留 |
| --- | --- | --- | --- |
| 业务逻辑缺陷 | 1 项（AI 中断信号传播） | 1 项 | 0 |
| 数据契约不一致 | 2 项（Word 表字段缺失 + 404 格式） | 2 项 | 0 |
| 边缘场景缺陷 | 1 项（localStorage 配额满） | 1 项 | 0 |
| 性能瓶颈 | 1 项（recharts 首屏加载） | 1 项 | 0 |
| 测试覆盖缺口 | 5 处 | 5 处（+21 用例） | 0 |

### 11.2 v3 修复记录

| # | 问题 | 根因 | 修复方案 | 涉及文件 | 状态 |
| --- | --- | --- | --- | --- | --- |
| v3-1 | **AI 代理 SSE 中断信号传播错误** | `fetchWithRetry` 中 `{ ...options, signal: controller.signal }` 用本地超时 signal **覆盖**了调用方传入的客户端中断 signal，导致 SSE 路由客户端断连后上游 AI 请求无法终止，浪费 token 与服务器资源 | 1) 在 `fetchWithRetry` 内部将调用方 `options.signal` 的 abort 事件转发到本地 controller（任一触发都中断 fetch）；2) SSE 路由 `req.on('close')` 改为 `res.on('close')` + `!res.writableEnded` 判断（Node 16+ 中 req 的 close 事件在请求体接收完成时即触发，会导致所有流式请求被立即中断） | `server/src/ai-proxy.ts` | ✅ 已修复 |
| v3-2 | **Word 实体字段在 SQLite 表中缺失** | words 表 schema 缺少 `exampleTranslation` 和 `phrases` 列，导致 AI 生成的 Word 数据通过 `sanitizeBody` 白名单过滤时被静默丢弃，用户保存的生词缺失翻译与短语 | 1) CREATE TABLE 语句新增 `exampleTranslation TEXT` + `phrases TEXT`；2) `phrases` 加入 `JSON_COLUMNS['words']`；3) 添加幂等迁移（PRAGMA table_info 检查 + ALTER TABLE） | `server/src/db.ts` | ✅ 已修复 |
| v3-3 | **routes.ts 404 错误响应格式不标准** | 3 处 404 响应返回 `{ error: 'Not found' }`（字符串），与项目统一的 `{ error: { code, message } }` 格式不一致，前端无法按 code 分支处理 | 统一为 `{ error: { code: 'NOT_FOUND', message: 'Not found' } }`（GET /:id / PUT /:id / DELETE /:id 三处） | `server/src/routes.ts` | ✅ 已修复 |
| v3-4 | **localStorage 未捕获 QuotaExceededError** | `useDarkMode` / `useTranslation` / `secureStorage.secureSetItem` 直接调用 `localStorage.setItem` 未捕获配额满异常，浏览器在存储耗尽时会抛 `QuotaExceededError` 导致组件崩溃 | 三处加 try/catch：dev 环境 `console.warn` 输出便于调试，生产环境静默降级为内存模式（state 正常更新，仅持久化失败）；`secureRemoveItem` 同步加 try/catch 防御隐私模式 `SecurityError` | `src/shared/hooks/useDarkMode.ts`、`src/shared/i18n/useTranslation.ts`、`src/shared/services/secureStorage.ts` | ✅ 已修复 |
| v3-5 | **recharts 首屏加载与文档注释不符** | `DashboardPage` 静态导入 `ReadingGrowthChart`（内部使用 recharts 408KB），导致访问首页 `/` 时立即下载 recharts，与"图表仅在有数据时渲染"的设计意图不符 | `DashboardPage` 改用 `React.lazy(() => import(...))` + `<Suspense fallback={...}>` 动态导入 `ReadingGrowthChart`；recharts 已分离为独立 chunk，首屏不再加载（仅当 `data.readingTrend.length > 0` 触发 Suspense 内 lazy 渲染时才下载） | `src/pages/DashboardPage.tsx` | ✅ 已修复 |

### 11.3 v3 新增测试用例（+21）

| 文件 | 新增用例 | 覆盖场景 |
| --- | --- | --- |
| `server/src/__tests__/aiProxy.test.ts` | +3 | SSE 正常转发 / 上游非 2xx 错误事件 / **客户端中断时上游 fetch signal 被中断**（核心 bug 修复验证，使用真实 http.createServer + clientReq.destroy()） |
| `server/src/__tests__/db.test.ts` | +1 | words 表 exampleTranslation/phrases 列读写 |
| `server/src/__tests__/routes.test.ts` | +1 | POST/GET /api/words 完整字段持久化与 JSON 反序列化 |
| `server/src/__tests__/routes.edge.test.ts` | 0（更新 3 处 404 断言） | 404 响应格式断言同步为新格式 |
| `src/shared/hooks/__tests__/useDarkMode.test.ts`（新建） | +8 | 基础路径 4 + 配额满 2 + 隐私模式 1 + DOM 同步 1，console.warn 断言验证 dev 警告 |
| `src/shared/i18n/__tests__/useTranslation.test.ts`（新建） | +8 | 基础路径 4 + 配额满 2 + 翻译连续性 1 + 隐私模式 1，console.warn 断言验证 dev 警告 |

### 11.4 v3 性能优化效果

| chunk | 优化前 | 优化后 | 效果 |
| --- | --- | --- | --- |
| `DashboardPage-*.js` | 含 `import"./recharts-*.js"` 静态依赖（recharts 代码进入首页 chunk） | 68.59 kB（gzip 11.20 kB），仅含 `import("./recharts-*.js")` 动态依赖 | **首屏访问 `/` 不再下载 recharts（节省 407.94 kB / gzip 113.10 kB）** |
| `recharts-*.js` | 407.94 kB（gzip 113.10 kB） | 407.94 kB（gzip 113.10 kB） | 独立 chunk 大小不变，改为按需加载 |

### 11.5 v3 验证状态

- ✅ 前端类型检查：零错误
- ✅ 前端 lint：零警告
- ✅ 前端构建：796 模块，8.33s（recharts 已分离独立 chunk）
- ✅ 前端测试：**539 通过**（44 文件，+16 用例 vs v2 基线 523）
- ✅ 服务端构建：零错误
- ✅ 服务端测试：**157 通过**（12 文件，+5 用例 vs v2 基线 152）
- ✅ 总计：**696 用例全绿**（vs v2 基线 675，+21 用例）
- ✅ Spec 12 个 Acceptance Scenario 全部验收通过（详见 `.trae/specs/audit-and-optimize-project-v3/checklist.md`）

### 11.6 v3 业务流程端到端验证结论

| 流程 | 链路完整性 | 备注 |
| --- | --- | --- |
| 每日文章生成 | ✅ 完整 | contentHash 去重 + 3 次重试 + 历史回退 |
| 阅读答题 | ✅ 完整 | 流式 SSE + Promise.allSettled 错误隔离 |
| 生词入库 | ✅ 完整 | 修复 Word 表字段缺失后链路完整 |
| SM-2 复习 | ✅ 完整 | easeFactor/interval clamp 正确 |
| 离线降级 | ✅ 完整 | 404 fallback 写本地、500 重新抛出 |
| AI 中断恢复 | ✅ 完整 | 修复 signal 合并 + res.on('close') 后链路完整 |

---

## 8. 项目垃圾清理

| 清理项 | 类型 | 处理方式 |
| --- | --- | --- |
| 空的 `api/` 目录 | 迁移残留 | ✅ 已删除 |
| `*.tsbuildinfo` 未被忽略 | 构建缓存 | ✅ 已添加到 .gitignore |
| `.env` / `.env.example` 过时注释 | 文档垃圾 | ✅ 已同步更新 |

### 未发现的问题（已确认清洁）

- ✅ 无 `.bak` / `.old` / `.tmp` / `.orig` 备份文件
- ✅ 无生产代码中的 `console.log` 调试残留（仅启动消息与 seed 脚本）
- ✅ 无重复文档（DEPLOYMENT.md 与 LINUX_DEPLOY.md 互补，非重复）
- ✅ `scripts/clean-build.sh` 仍为有效工具脚本

---

## 9. 验证结果

### 9.1 类型检查

```
前端：npm run typecheck → tsc -b --noEmit → 零错误
服务端：npm --prefix server run build → tsc → 零错误
```

### 9.2 测试

| 测试套件 | 测试文件数 | 测试用例数 | 通过 | 失败 | 耗时 |
| --- | --- | --- | --- | --- | --- |
| 前端（vitest） | 42 | 523 | 523 | 0 | 21.24s |
| 服务端（vitest） | 12 | 152 | 152 | 0 | 19.46s |
| **合计** | **54** | **675** | **675** | **0** | **40.70s** |

### 9.3 构建

```
前端：npm run build → tsc -b && vite build → 796 模块，8.41s，PWA 36 entries
服务端：npm --prefix server run build → tsc → 零错误
```

---

## 10. 后续建议

### 10.1 短期建议（低优先级）

1. ~~**AI 代理鉴权**：如需多用户部署，实现 `AI_PROXY_TOKEN` 校验逻辑~~（已完成：多用户 P0/P3 改为会话令牌鉴权 + 按用户配额）
2. **加密密钥轮换**：当前密钥配置后不可更改，可设计密钥版本号支持轮换
3. **测试覆盖率提升**：当前 675 个测试覆盖核心路径，可补充边缘场景测试

### 10.2 中期建议

1. **监控告警**：接入 Prometheus + Grafana 监控 AI 调用量、错误率、响应时间
2. **日志结构化**：将 console.error/warn/debug 升级为结构化 JSON 日志（pino/winston）
3. **CI/CD 流水线**：GitHub Actions 自动运行 typecheck + test + build

### 10.3 长期建议

1. **多用户支持**：如需扩展为多用户场景，需引入鉴权层与数据隔离
2. **AI 供应商扩展**：AIProvider 抽象已就绪，可按需扩展其他供应商
3. **PWA 离线能力增强**：当前 Dexie 仅作只读缓存，可增强离线写入能力

---

## 附录：修改文件清单

| 文件 | 修改类型 | 说明 |
| --- | --- | --- |
| `.env` | 安全+文档 | 清空前端密钥、更新加密/CORS 注释 |
| `.env.example` | 文档 | 同步 .env 注释更新 |
| `.gitignore` | 清理 | 添加 `*.tsbuildinfo` |
| `package.json` | 安全 | react-router-dom 升级至 6.30.4 |
| `server/src/index.ts` | 安全 | AI 代理独立限流 20/min |
| `server/src/ai-proxy.ts` | 安全 | 请求体 schema 校验 |
| `server/src/encryption.ts` | 安全+修复 | 生产环境 fail-fast + 移除未用常量 |
| `server/src/__tests__/aiProxy.test.ts` | 修复+增强 | 修复 8 个失败测试 + 新增 3 个校验测试 |
| `src/shared/services/ai/baseProvider.ts` | 修复 | 超时错误消息 30s → 60s |
| `docs/API_REFERENCE.md` | 文档 | 全量更新（模型名/超时/接口/限流/校验/CORS/脱敏） |
| `docs/TECHNICAL_ANALYSIS.md` | 文档 | 主题注入与超时描述更新 |
| `docs/PROJECT_ANALYSIS_REPORT.md` | 新增 | 本报告 |
