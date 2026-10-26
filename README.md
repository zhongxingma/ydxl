# 英语学习应用（ydxl）

一个面向个人学习者的定制化英语学习辅助 PWA 应用，集成每日阅读、重点短语、词汇汇总、生词本、五步背诵、学习统计与本地服务器存储功能。前端数据通过 Dexie.js 离线缓存（IndexedDB），后端使用本地 Express + SQLite 持久化数据，支持局域网内多端访问与离线降级。

## 功能特性

- **多用户与数据隔离**：账号密码登录（scrypt 哈希 + 不透明会话令牌，7 天滑动过期）；文章/题目全站共享（AI 生成一篇全站使用），生词本/复习/统计/成就按用户严格隔离（SQL 层强制）；阅读进度（已读/开始时间）按用户独立；连续登录失败 5 次锁定 15 分钟；修改密码全端下线
- **每日阅读**：基于 AI 生成不同文体（记叙文/说明文/应用文/议论文）的英文文章，覆盖新课标三大主题、12 类题材与 3 个生活化题材（中华传统文化/人工智能与生活/个人成长，专属防套话创作简报），提供阅读理解题目、语法填空、单词释义、整段翻译切换与发音朗读；prompt 注入随机叙事视角 + 采样温度提升，避免文章模板化。
- **一键打印完整练习**：阅读页顶栏「打印」按钮一键输出完整纸质练习——文章原文、阅读理解题、语法填空、参考答案与解析、重点单词、重点短语、全文翻译七个部分，题目未生成时自动补齐后再打印，支持「另存为 PDF」。
- **阅读理解与语法填空**：AI 按文体命题 5 道选择题（主旨/细节/推断/词义猜测等，干扰项附解析）+ 5 道语法填空题（时态/语态/从句/非谓语等中考高频考点，含四层深度解析）。
- **纯英文阅读模式**：阅读模式新增「纯英文」选项（设为默认），仅展示英文原文不显示中文翻译，沉浸式训练纯英文阅读能力；同时保留段落对照、按句显示、逐句切换模式。
- **全文朗读**：文章正文底部提供朗读控制条，支持播放/暂停、停止、语速调节（0.5x-1.5x）与段落进度显示；纯英文模式下段落顶部喇叭按钮可单独朗读指定段落；朗读时当前段落高亮（依赖浏览器 Web Speech API）。
- **历史阅读记录**：首页「最近阅读」模块按时间倒序展示历史阅读记录，每条记录显示相对时间与阅读状态徽章（已读/阅读中），支持分页加载。
- **相关文章推荐**：首页「相关推荐」模块基于历史阅读内容的评分算法智能推荐同主题文章，帮助拓展阅读。
- **阅读存档去重**：基于「标题+正文」计算 SHA-256 contentHash 文章指纹（前 16 位），AI 生成后查重命中自动重试（最多 3 次），3 次仍重复则回退最新历史文章；AI prompt 注入最近 5 篇文章的主题避免重复。
- **重点短语**：AI 从文章提取 5-8 个重点短语（含释义、原文例句与例句翻译），短语汇总页按文章分组浏览。
- **词汇汇总**：AI 提取文章重点词汇（音标/词性/释义/例句/重要度分级），词汇汇总页按文章分组浏览，可一键加入生词本。
- **生词本**：从阅读材料中一键收藏生词，自动查询/AI 补全释义/音标/词性；支持批量操作、笔记编辑（加密存储）、掌握度进度条、字母排序与按状态筛选。
- **五步背诵**：基于 SM-2 间隔重复算法，针对每个生词依次执行 学习 → 阅读 → 听写 → 拼写 → 写作 五个步骤，逐步加深记忆；支持顽固词优先、每日复习上限与到期提醒。
- **已掌握单词**：掌握度达标（5 级）的单词自动进入已掌握页面归档，支持复习巩固与移出。
- **学习统计**：基于 Recharts 提供阅读量、生词量、掌握度、连续打卡天数等 KPI 卡片与趋势图表，支持按日期区间筛选。
- **成就系统**：解锁式成就墙（阅读量/词汇量/连续打卡等规则驱动），达成时弹出庆祝提示。
- **多 AI 供应商 + 自动兜底**：支持 DeepSeek / OpenAI / 通义千问 / 自定义模型（任意 OpenAI 兼容端点）四类供应商；自定义模型优先调用，失败自动降级 DeepSeek 兜底（`FallbackAIProvider`）；个人中心切换供应商免刷新即时生效。
- **界面双语**：内置中/英界面文案（zh-CN / en-US），个人中心一键切换，跨标签页同步。
- **本地服务器存储**：学习数据通过本地 Express 服务器落盘到 SQLite（用户笔记 AES-256-GCM 加密），前端以服务器为主策略读写；断网时自动回退到 Dexie 离线缓存。
- **PWA 离线访问**：通过 Service Worker 预缓存核心资源，断网情况下仍可查看已加载内容。
- **夜间模式**：基于 Tailwind `darkMode: 'class'` 实现，可一键切换日/夜主题。

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 前端框架 | React 18 |
| 构建工具 | Vite 6 |
| 类型系统 | TypeScript 5（strict 全开） |
| 样式方案 | TailwindCSS 3 |
| 状态管理 | Zustand |
| 前端数据层 | Dexie.js 4（IndexedDB 封装，v7 schema 8 张表，离线只读缓存） |
| 后端框架 | Express 4（本地服务器） |
| 服务端存储 | better-sqlite3（本地 SQLite，WAL 模式） |
| 路由 | React Router 6（路由级 lazy loading） |
| 图表 | Recharts |
| PWA | vite-plugin-pwa + Workbox |
| AI 接口 | DeepSeek / OpenAI / 通义千问 / 自定义模型（OpenAI 兼容协议），代理模式隐藏密钥，自定义优先 + DeepSeek 兜底自动降级 |
| 国际化 | 自研 i18n（zh-CN / en-US JSON 字典 + useTranslation hook） |
| 测试框架 | vitest（前端 138 + 后端 22，共 160 个测试文件）+ Playwright（E2E，7 spec 11 用例，含生产 SW 离线验证） |
| 代码规范 | ESLint + Prettier + Husky + lint-staged |

## 快速开始

### 环境要求

- Node.js >= 20（推荐 20 LTS；Node 18 缺少全局 WebCrypto，无法完成生产构建）
- npm >= 9
- Linux 服务器（生产部署，推荐 Ubuntu 22.04 / Debian 12）

> 版本要求与 `package.json` 的 `engines` 字段保持一致。运行 `node -v` 与 `npm -v` 可查看当前版本，如版本过低请先升级 Node.js（推荐使用 [nvm](https://github.com/nvm-sh/nvm) 或 [nvm-windows](https://github.com/coreybutler/nvm-windows) 管理多版本）。

### 安装依赖

```bash
# 前端依赖
npm install

# 服务器子包依赖
npm --prefix server install
```

### 配置环境变量

复制 `.env.example` 为 `.env` 并按需填写：

```bash
# macOS / Linux
cp .env.example .env

# Windows (PowerShell)
copy .env.example .env
```

完整变量说明见下方 [环境变量说明](#环境变量说明)。自定义模型的端点与模型 ID 统一在 `config/ai-providers.json` 声明（详见 [AI 供应商配置](#ai-供应商配置)）。

### 启动开发服务器

开发模式下需要同时启动前端开发服务器与本地 API 服务器：

```bash
# 终端 1：启动本地 API 服务器（监听 3001 端口）
npm run server:dev

# 终端 2：启动前端 Vite 开发服务器
npm run dev
```

前端默认监听 `http://localhost:5173`，Vite dev server 自动将 `/api` 请求代理到 `http://localhost:3001`（见 `vite.config.ts` 的 `server.proxy` 配置）。

### 构建生产版本

```bash
# 前端构建（tsc -b 类型检查 + vite build + PWA）
npm run build

# 服务器构建
npm run server:build
```

前端产物输出到 `dist/`，包含静态资源与 PWA Service Worker。服务器产物输出到 `server/dist/`。

### 代码检查与格式化

```bash
npm run lint        # ESLint 检查
npm run lint:fix    # ESLint 自动修复
npm run format      # Prettier 格式化
```

## 环境变量说明

`.env.example` 包含所有必需变量，分为前端可见（`VITE_` 前缀）与服务器端独有两类。

### 前端变量（Vite 构建时注入 bundle）

| 变量名 | 作用 | 备注 |
| --- | --- | --- |
| `VITE_AI_PROVIDER` | AI 供应商选择 | `deepseek` / `openai` / `qwen` / `custom`，默认 `deepseek`；使用自定义模型须改为 `custom` |
| `VITE_DEEPSEEK_API_KEY` | DeepSeek API Key | 仅前端直连时使用；生产环境留空走代理 |
| `VITE_DEEPSEEK_MODEL` | DeepSeek 模型名 | 默认 `deepseek-v4-pro`，轻量任务自动降级 `deepseek-v4-flash` |
| `VITE_OPENAI_API_KEY` / `VITE_OPENAI_MODEL` | OpenAI 配置 | 默认 `gpt-5.2`，轻量 `gpt-5.2-mini` |
| `VITE_QWEN_API_KEY` / `VITE_QWEN_MODEL` | 通义千问配置 | DashScope 兼容模式，默认 `qwen3-max` |
| `VITE_CUSTOM_API_ENDPOINT` | 自定义模型端点 | Base URL（自动补 `/chat/completions`）或完整 URL；统一由 `config/ai-providers.json` 注入 |
| `VITE_CUSTOM_MODEL` | 自定义模型 ID | 由 `config/ai-providers.json` 注入 |
| `VITE_CUSTOM_API_KEY` | 自定义模型密钥（可选） | ⚠️ 会打进前端产物公开可见，生产环境务必留空，密钥放服务端 |
| `VITE_API_BASE_URL` | 本地服务器 API 基础路径 | 默认 `/api`，开发环境通过 Vite proxy 转发到 `http://localhost:3001` |
| `VITE_AI_PROXY_URL` | AI 代理地址 | 默认 `/api`；前端自动拼接 `/v1/ai-proxy/<provider>` 后缀；留空则前端直连上游 |

### 服务端变量（不打包进 bundle）

| 变量名 | 作用 | 备注 |
| --- | --- | --- |
| `CUSTOM_API_KEY` | 自定义模型上游密钥 | 生产环境自定义模型的密钥放这里（代理转发） |
| `CUSTOM_API_ENDPOINT` / `CUSTOM_MODELS` | 自定义端点/模型白名单 | 由 `server/src/index.ts` 启动时从 `config/ai-providers.json` 自动派生，无需手动配置 |
| `DEEPSEEK_API_KEY` | 服务端 DeepSeek Key | 代理模式下必填，留空导致 503 `PROXY_NOT_CONFIGURED` |
| `OPENAI_API_KEY` / `QWEN_API_KEY` | 服务端 OpenAI/千问 Key | 仅在选用对应供应商时必配 |
| `NODE_ENV` | 运行环境 | `production` 启用安全默认（CORS 仅本机、错误脱敏、强制 `ENCRYPTION_KEY`） |
| `PORT` | 服务器监听端口 | 默认 `3001` |
| `CORS_ORIGIN` | CORS 来源白名单 | 逗号分隔；未配置时开发环境允许所有来源，生产默认仅本机 |
| `TRUST_PROXY` | 反向代理信任 | Nginx 反代后设为 `1`；未配置时 `req.ip` 为反代地址，限流与审计 IP 会失真 |
| `ENCRYPTION_KEY` | 数据加密密钥 | 32 字节 hex（`openssl rand -hex 32`）；生产未配置时拒绝启动；配置后切勿更改 |
| `DB_PATH` | SQLite 数据库路径 | 留空按 `NODE_ENV` 自动选择；`test` 环境用内存数据库 |
| `ADMIN_USERNAME` | 管理员登录名 | 默认 `admin`；仅首次多用户迁移（users 表为空）时生效 |
| `ADMIN_INITIAL_PASSWORD` | 管理员初始密码 | 留空自动生成随机密码打印控制台一次；生产建议显式配置强密码 |

> ⚠️ 安全提示：`VITE_` 前缀变量会被打包进前端 bundle，切勿放置真实生产密钥；生产环境密钥一律配置在服务端（`CUSTOM_API_KEY` / `DEEPSEEK_API_KEY` 等），由本地服务器代理转发到上游 AI 供应商。

## AI 供应商配置

本项目支持四类 AI 供应商，统一走 OpenAI Chat Completions 兼容协议：

| 供应商 | 默认模型（高质量/轻量） | 直连端点 |
| --- | --- | --- |
| DeepSeek（默认兜底） | `deepseek-v4-pro` / `deepseek-v4-flash` | `https://api.deepseek.com/chat/completions` |
| OpenAI | `gpt-5.2` / `gpt-5.2-mini` | `https://api.openai.com/v1/chat/completions` |
| 通义千问 | `qwen3-max` / `qwen3-turbo` | DashScope compatible-mode |
| 自定义（custom） | 由 `config/ai-providers.json` 指定 | 任意 OpenAI 兼容端点（OpenRouter / SiliconFlow / Ollama / Groq 等） |

### 供应商选择优先级

```
个人中心配置（localStorage，运行时热切换）
  > VITE_AI_PROVIDER 环境变量（构建时默认）
  > custom 自动检测（VITE_CUSTOM_API_ENDPOINT + VITE_CUSTOM_MODEL 配齐时自动启用）
  > deepseek（最终兜底）
```

### 自定义模型（custom 优先 + DeepSeek 兜底）

自定义模型端点/模型与兜底供应商在 `config/ai-providers.json` 声明（内置供应商默认元数据由 `server/src/aiConfig.ts` 提供，可用 `providers` 段覆盖），密钥值只写服务端 `.env`：

```json
{
  "custom": {
    "endpoint": "https://openrouter.ai/api/v1",
    "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "keyEnv": "CUSTOM_API_KEY"
  },
  "fallback": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash"
  }
}
```

- **单一注册表**：custom 的端点 / 模型与 fallback 供应商在此声明；内置供应商默认元数据在 `server/src/aiConfig.ts` 的 `DEFAULT_PROVIDERS`（可用 JSON `providers` 段覆盖）。`vite.config.ts` 的 `VITE_CUSTOM_*` / `VITE_FALLBACK_*` 注入与 `ai-proxy.ts` 的 UPSTREAMS 均从它派生；内置供应商的默认 / 轻量模型由前端 `AI_PROVIDER_META` 维护
- **密钥安全**：JSON 只存密钥「变量名」（`keyEnv`），实际值写服务端 `.env`（如 `CUSTOM_API_KEY`），绝不进前端 bundle
- 前端构建时自动注入 `VITE_CUSTOM_API_ENDPOINT` / `VITE_CUSTOM_MODEL`；服务端启动时自动派生 `CUSTOM_API_ENDPOINT` / `CUSTOM_MODELS`，无需在 `.env` 重复配置
- 兜底供应商由 `fallback` 字段声明（仅允许 `deepseek` / `openai` / `qwen`），密钥放服务端 `.env`
- **自动降级链**：自定义 API 失败（网络/超时/HTTP 错误/JSON 不合格）→ `FallbackAIProvider` 以相同参数自动重试 DeepSeek 兜底 → 仍失败则业务层降级兜底素材库，保证核心功能始终可用；流式输出已产出内容后不降级（避免内容重复）
- 生产环境自定义模型也走服务端 `/api/v1/ai-proxy/custom` 代理（规避浏览器直连第三方 API 的 CORS 限制），服务端支持 `CUSTOM_MODELS` 模型白名单
- 针对第三方模型的兼容性处理已内置：`json_object` 模式数组语义冲突自动门控、对象包装数组自动解包（`parseJsonArrayResponse`）、空 `highlightedWords` 校验降级

详细配置速查见 [docs/AI_API_CONFIGURATION.md](./docs/AI_API_CONFIGURATION.md)。

### 运行时切换

在「我的」页面 AI 设置区：
1. 选择供应商（DeepSeek / OpenAI / 通义千问 / 自定义）
2. 输入对应 API Key（加密存储在本地浏览器）
3. 可选：填写端点与模型名覆盖默认值（自定义模型）
4. 点击「测试连接」验证
5. 保存后**下一次请求即时生效**，无需刷新页面或重新构建

## 安全

本项目面向本地 / 局域网部署，多用户认证（P0）已启用：全部业务 API（除 `/api/health` 与 `/api/auth/*`）需要登录会话。安全机制如下：

- **认证与会话**：账号密码登录（scrypt N=16384 慢哈希），不透明 256 位会话令牌存服务端 sessions 表（7 天滑动过期，可即时吊销）；前端令牌存 sessionStorage（关标签即失效）；连续失败 5 次锁定 15 分钟 + 登录端点 5/min/IP 限流；登录失败统一文案防用户名枚举。
- **数据隔离**：私有表（生词/复习/统计/阅读会话/成就）在 SQL 层强制 `WHERE userId = 当前用户`，id 存储为 `userId:业务id`（服务端透明映射，前端无感）；文章/题目全站共享；阅读状态（readAt/startedAt）存独立的 user_article_states 表。
- **服务端限流（60/min）**：Express 引入 `express-rate-limit`，每 IP 每分钟 60 次请求，超限返回 HTTP 429 结构化错误；健康检查端点 `/api/health` 豁免。AI 代理端点独立限流（20/min）。
- **CORS 白名单**：通过 `CORS_ORIGIN` 配置允许的来源（逗号分隔）；未配置时开发环境允许所有来源，生产默认仅本机。仅放行 `GET / POST / PUT / DELETE / OPTIONS` 与 `Content-Type`、`x-user-token` 请求头。
- **密钥隔离**：所有上游密钥（`CUSTOM_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `QWEN_API_KEY`）仅存服务端，不进入前端 bundle；前端用户个人密钥经 secureStorage 加密存储在浏览器本地。
- **模型白名单**：服务端 `CUSTOM_MODELS` 限定 custom 代理可转发的模型 ID，未配置时由部署者约定。
- **数据加密**：用户敏感字段（生词笔记 `words.note`）使用 AES-256-GCM 应用层加密存储；生产环境未配置 `ENCRYPTION_KEY` 时服务端拒绝启动（fail-fast），避免明文落盘。
- **SQL 注入防护**：REST 路由使用表名/列名白名单 + 参数化查询。

## 测试

本项目使用 [vitest](https://vitest.dev/) 作为测试框架，前端与后端独立运行。

### 运行测试

```bash
# 前端测试
npm test
npm run test:coverage   # 覆盖率报告（text-summary / html / lcov，含防回退阈值校验）
npm run test:watch   # 监听模式

# 后端测试
npm --prefix server test

# 浏览器级 E2E（Playwright：自动启动 vite dev，/api 由 fixture 拦截，需 Node 20+ 与系统 Chrome）
npm run test:e2e

# 生产构建 SW 离线验证（vite build + vite preview，验证 Workbox 预缓存）
npm run test:e2e:sw
```

### 当前测试规模

- **前端**：138 个测试文件，1188 个用例 — 覆盖 AI Provider（多供应商路由/动态切换/自动兜底/JSON 容错）、文章生成与去重、题目与语法填空、一键打印工作表、SM-2 背诵算法、五步复习状态机与步骤组件（含朗读 / 练习交互）、复习练习生成器、生词本（列表分页 / 批量操作 / 添加与批量导入）、选词浮层、添加文章表单、阅读完成与答题编排、阅读页生命周期、全文朗读、音节与语音工具、重点短语 / 词汇汇总、庆祝动画、学习统计页、用户管理 / 审计日志 / 班级学情页、登录设备管理、个人设置持久化、仪表盘文章列表、通知服务、长按手势、统计与成就、通用仓储与离线缓存降级、认证服务（登录/换号清缓存/登出/会话管理）、端到端业务流
- **后端**：22 个测试文件，216 个用例 — 覆盖 SQLite 表与 CRUD、REST 路由（含边界）、限流、CORS、加密、AI 代理契约、认证（登录/锁定/会话）、多用户数据隔离、单用户→多用户数据迁移、RBAC 权限矩阵与用户管理、审计日志、班级学情聚合、AI 配额按用户计量、会话管理、共享内容写权限
- **E2E**：Playwright 7 个 spec 共 11 个用例 — 阅读路径（AI 失败分支 / 答题成功分支）、复习五步全流程、离线回退（dev：Dexie 本地缓存）、生产构建 SW 离线验证（preview：Workbox 预缓存整页重载）、生词本添加、打印工作表（AI 失败降级 / 完整版）、多用户切换（登出拦截 / 换账号清缓存 / 同账号保留）

测试策略详见 [docs/TESTING.md](./docs/TESTING.md)。

## 故障排查

### AI 调用失败

- **错误：`AIError: 请求超时（170s）`** — 前端 170 秒未收到响应，检查网络或上游 AI 供应商可达性（推理模型思考时间长，属正常上限）
- **错误：`HTTP 401 Unauthorized`** — apiKey 无效或过期，检查对应供应商密钥（前端直连查 `VITE_*_API_KEY`，代理模式查服务端 `*_API_KEY`）
- **错误：`HTTP 503 PROXY_NOT_CONFIGURED`** — 服务端未配置对应供应商密钥（或 custom 未配置 `CUSTOM_API_ENDPOINT`）；custom 503 时前端会自动回退 DeepSeek 兜底
- **错误：`HTTP 504 TIMEOUT`** — 上游 AI 接口未响应（服务端 150s 上游超时），重试或检查网络
- **错误：`HTTP 429`** — 速率限制，降低调用频率或切换供应商
- **自定义模型返回 JSON 解析失败** — 已内置三级容错（直接解析/markdown 围栏/平衡块提取）与数组对象解包；持续失败时 `FallbackAIProvider` 自动切换 DeepSeek

### 服务器连接失败

- **现象：fetch 报错 `API /api/xxx 网络请求失败`** — 本地服务器未启动，执行 `npm run server:dev`（开发）或 `npm run server:start`（生产）
- **现象：前端提示「网络不可用，仅可查看已缓存数据」** — 服务器不可达，应用自动回退到 Dexie 离线缓存；恢复后下次访问重新拉取
- **现象：API 返回 404** — 确认请求路径为 `${VITE_API_BASE_URL}/<table>`（如 `/api/articles`）

### IndexedDB 损坏

- **现象：Dexie 报错 `QuotaExceededError`** — 清理浏览器缓存或删除旧数据库
- **现象：数据丢失** — 浏览器隐私模式下 IndexedDB 可能不持久，使用正常模式
- **修复：** 浏览器控制台执行 `indexedDB.deleteDatabase('ydxl-db')` 后刷新，数据库会重建并从服务器拉取最新数据

### PWA 缓存过期

- **现象：更新部署后用户看到旧版本** — vite-plugin-pwa 默认 autoUpdate，等待浏览器下次启动时更新
- **强制更新：** 浏览器控制台执行 `caches.keys().then(ks => ks.forEach(k => caches.delete(k)))` 后刷新

### better-sqlite3 原生模块报错（迁移服务器场景）

- **错误：`invalid ELF header`** — node_modules 从其他平台（如 Windows x86）直接拷贝到 ARM/Linux 服务器导致二进制不兼容，在项目目录执行 `npm rebuild better-sqlite3` 或删除 node_modules 重装

## 部署与运维

本项目的部署、运维、API 参考与技术分析文档已独立维护：

| 文档 | 说明 |
| --- | --- |
| [docs/LINUX_DEPLOY.md](./docs/LINUX_DEPLOY.md) | 实战 Linux 部署指南：Ubuntu 22.04 / Debian 12 逐步命令、PM2 / systemd、Nginx 反代、SSL、防火墙端口 |
| [docs/AI_API_CONFIGURATION.md](./docs/AI_API_CONFIGURATION.md) | AI API 配置速查：custom 供应商与兜底供应商的单一配置入口 `config/ai-providers.json` |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 部署指南：本地开发部署、Linux 服务器部署、环境变量矩阵、构建产物说明、PWA 注意事项 |
| [docs/OPERATIONS.md](./docs/OPERATIONS.md) | 运维手册：SQLite 备份策略、服务监控、性能指标、日志查看、版本升级、安全审计清单 |
| [docs/API_REFERENCE.md](./docs/API_REFERENCE.md) | API 参考：AIProvider 方法、Local Server REST API、AI 代理端点、Repository 接口、核心数据类型 |
| [docs/DATABASE.md](./docs/DATABASE.md) | 数据库设计：SQLite 12 张表（7 业务 + 5 多用户）+ Dexie 8 张表的字段、索引、迁移与加密机制 |
| [docs/CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) | 开发规范：TypeScript / React / 数据层 / 安全 / AI Provider / 测试编码规范 |
| [docs/TECHNICAL_ANALYSIS.md](./docs/TECHNICAL_ANALYSIS.md) | 技术分析：SM-2 加权算法、存储架构、指数退避重试、Dexie 索引优化、PWA 缓存策略 |

其他相关文档：

- [docs/README.md](./docs/README.md) — **文档索引**：全部文档按用途分类导航
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 分层架构图、模块依赖图、数据流图、AI 多供应商抽象层设计
- [docs/MULTI_USER_DESIGN.md](./docs/MULTI_USER_DESIGN.md) — 多用户架构方案（P0 认证隔离、P1 RBAC、P2 审计日志、P3 加固与运营均已实施）：数据隔离、RBAC、审计日志、迁移与分阶段实施
- [docs/ER_DIAGRAM.md](./docs/ER_DIAGRAM.md) — 数据表实体关系图（camelCase 字段）
- [docs/archive/](./docs/archive/) — 历史分析与测试报告归档（快照，不随代码更新）
- [docs/TESTING.md](./docs/TESTING.md) — 测试策略与 vitest 配置
- [docs/USER_GUIDE.md](./docs/USER_GUIDE.md) — 用户使用手册：面向最终用户的功能说明
- [docs/CACHING.md](./docs/CACHING.md) — AI 响应缓存与 Dexie 缓存策略
- [docs/AI_TOKEN_OPTIMIZATION.md](./docs/AI_TOKEN_OPTIMIZATION.md) — AI Token 成本优化
- [docs/UPGRADE.md](./docs/UPGRADE.md) — 版本升级指引
- [CONTRIBUTING.md](./CONTRIBUTING.md) — 贡献指南（commit 规范 / 分支 / PR 流程）
- [SECURITY.md](./SECURITY.md) — 安全政策（安全机制、已知边界、漏洞报告渠道）
- [CHANGELOG.md](./CHANGELOG.md) — 变更日志
- [BUGLOG.md](./BUGLOG.md) — Bug 跟踪日志（分级登记、修复与回归验证）
- [LICENSE](./LICENSE) — MIT 许可证

## 项目结构说明

```
ydxl/
├── config/
│   └── ai-providers.json       # AI 供应商单一注册表（providers 元数据 + custom + fallback，密钥只存变量名）
├── server/                     # 本地服务器子包（Express + better-sqlite3）
│   ├── src/
│   │   ├── index.ts            # Express 入口（中间件链/路由挂载/config 派生）
│   │   ├── db.ts               # SQLite 12 张表 schema（7 业务 + 5 多用户；WAL/索引/加密字段/JSON 列）
│   │   ├── routes.ts           # REST 路由统一出口（实现拆分在 routes/：表路由/文章路由/批量路由/共享工具）
│   │   ├── routes/             # 路由子模块（shared/tableRouter/articlesRouter/wordsBulkRouter）
│   │   ├── auth.ts             # 认证核心（scrypt 哈希/会话签发与滑动过期/失败锁定）
│   │   ├── authRoutes.ts       # /api/auth/* 路由（login/logout/me/change-password/sessions 会话管理）
│   │   ├── permissions.ts      # RBAC 权限矩阵与 requirePermission 授权中间件（P1）
│   │   ├── adminRoutes.ts      # /api/admin/* 用户管理与审计日志查询（P1/P2）
│   │   ├── classStats.ts       # 班级学情 SQL 聚合（stats:class，P3）
│   │   ├── audit.ts            # 审计日志写入/查询/CSV 归档与 180 天保留策略（P2）
│   │   ├── migrateMultiUser.ts # 单用户→多用户数据迁移（id 加 userId 前缀 + schema_meta 标记）
│   │   ├── ai-proxy.ts         # AI 代理（deepseek/openai/qwen/custom + /stream 变体）
│   │   ├── aiConfig.ts         # AI 供应商配置加载（config/ai-providers.json 单一注册表）
│   │   ├── seed.ts             # 可选初始化脚本（演示数据）
│   │   ├── loadtest.ts         # 性能压测脚本（纯 Node fetch，默认 30 并发 / 300 请求，P3）
│   │   └── encryption.ts       # AES-256-GCM 字段加密（ENCRYPTION_KEY）
│   └── package.json            # 独立子包（express/better-sqlite3/cors/rate-limit）
├── public/                     # 静态资源（PWA 图标等，不参与打包）
├── src/
│   ├── features/               # 特性模块（按业务域垂直拆分）
│   │   ├── reading/            # 每日阅读（文章/题目/语法填空/词汇/短语/朗读）
│   │   ├── wordbook/           # 生词本管理（收藏/筛选/批量/笔记）
│   │   ├── review/             # 五步背诵 + SM-2 算法
│   │   ├── mastered/           # 已掌握单词归档
│   │   ├── vocabulary/         # 词汇汇总（按文章分组）
│   │   ├── phrases/            # 重点短语（按文章分组）
│   │   ├── stats/              # 学习统计 + 成就系统
│   │   ├── profile/            # 我的（AI 设置/学习目标/偏好）
│   │   └── auth/               # 登录与访问守卫（LoginPage / RequireAuth）
│   ├── pages/                  # 顶层页面（Dashboard 首页仪表盘）
│   ├── shared/                 # 跨特性共享层
│   │   ├── components/         # 通用 UI（Layout/ErrorBoundary/icons/Badge）
│   │   ├── hooks/              # 通用 hooks（useDarkMode/useOnlineStatus 等）
│   │   ├── i18n/               # 国际化（useTranslation + zh-CN/en-US 字典）
│   │   ├── services/           # 共享服务
│   │   │   ├── ai/             # AI Provider 抽象（4 供应商 + Fallback + 动态 Proxy + jsonParsing + requestRunner）
│   │   │   ├── db.ts           # Dexie v7 schema（8 张表含 aiCache）
│   │   │   ├── localApi.ts     # REST 客户端（离线事件通知）
│   │   │   ├── remoteRepository.ts # CachedRemoteRepository（服务器为主 + 离线回退）
│   │   │   ├── repositories.ts # 各表仓储实例
│   │   │   ├── secureStorage.ts# 用户密钥/敏感数据加密存储
│   │   │   └── ...             # settings/storageManager/notification/cacheEvents
│   │   ├── types/              # 共享类型定义
│   │   └── utils/              # 工具函数（contentHash/cn/relativeTime 等）
│   └── test/                   # 测试基建（setup.ts：fetch mock/jest-dom/环境隔离）
├── index.html                  # HTML 入口
├── vite.config.ts              # Vite 构建（PWA/manualChunks/dev proxy/config 注入）
├── vitest.config.ts            # 测试配置（jsdom/环境变量隔离/@ 别名）
└── .env.example                # 环境变量示例（前端 + 服务端全量注释）
```

**目录职责约定**：

- `features/*`：每个特性模块自包含 components/pages/services/hooks/store，对外通过 `index.ts` 桶文件导出公共 API，模块间不互相引用内部文件，跨特性复用一律走 `shared/`。
- `shared/services/ai`：AI Provider 抽象层，所有 AI 调用统一经 `aiProvider` 动态 Proxy 出口；具体供应商（DeepSeek/OpenAI/Qwen/Custom）继承 `BaseAIProvider` 模板方法基类，`FallbackAIProvider` 实现自定义优先 + DeepSeek 兜底自动降级。
- `shared/services`：跨特性共享数据层 —— Dexie 仓储（离线缓存）、localApi（REST 客户端）、CachedRemoteRepository（服务器为主 + 离线回退）、secureStorage（加密存储）。
- `server/`：独立子包，提供本地存储 REST API、认证 API 与 AI 代理端点，前端通过 `${VITE_API_BASE_URL}` 访问。
- `config/`：构建期与运行期共享的声明式配置（AI 供应商端点/模型），改动后需重新构建前端并重启服务端。

## 数据存储架构

应用采用**服务器为主 + Dexie 离线只读缓存**的存储策略：

- **写入路径**：前端 → localApi（fetch）→ Express → SQLite；写入成功后同步更新 Dexie 缓存
- **读取路径**：前端 → localApi → Express → SQLite；读取成功后同步到 Dexie 缓存；fetch 失败时回退 Dexie 读取（SWR 模式：本地命中立即返回，后台静默刷新）
- **离线降级**：服务器不可达时触发 `ydxl:offline` 自定义事件，Layout 监听并显示离线提示；读取自动回退 Dexie 缓存
- **表结构**：服务器 SQLite 12 张表（7 业务：articles/questions/words/reviews/stats/readingSessions/achievements + 5 多用户：users/sessions/user_article_states/schema_meta/operation_logs），Dexie v7 schema 8 张表（额外含 aiCache 用于 AI 响应缓存），字段均为 camelCase
- **数据同步方向**：服务器为唯一权威数据源，Dexie 仅作只读缓存，不存在反向同步

## 浏览器兼容性

- 构建目标：`es2020`
- 浏览器范围：`> 0.5%`、`last 2 versions`、`not dead`、`not ie 11`
- 使用的现代 Web API：IndexedDB（通过 Dexie）、fetch、Web Crypto（SHA-256）、Web Speech API（speechSynthesis）、Notification；均在调用前做能力检测，不支持时优雅降级，无需 polyfill

## 许可证

MIT License
