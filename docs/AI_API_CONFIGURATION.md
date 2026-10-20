# AI API 配置速查（统一配置）

核心原则：**所有 AI 供应商的元数据（端点 / 模型 / 白名单 / 密钥变量名）在 `config/ai-providers.json` 单一注册表声明；实际密钥值只写服务端 `.env`。** 代理模式（默认）下前端零密钥配置，密钥由服务端持有。

> ⚠️ **安全红线**：切勿把密钥的**值**写进 `config/ai-providers.json`。该文件只存密钥的「变量名」（`keyEnv`，如 `"DEEPSEEK_API_KEY"`），实际值写服务端 `.env`。`vite.config.ts` 只注入端点 / 模型，绝不注入任何密钥值进前端 bundle。

***

## 一、单一注册表：config/ai-providers.json

全部 AI 供应商元数据在此**一处声明**，前端构建与服务端运行时均从它派生，消除多处手写不一致。

```json
{
  "providers": {
    "deepseek": {
      "endpoint": "https://api.deepseek.com/chat/completions",
      "model": "deepseek-v4-pro",
      "flashModel": "deepseek-v4-flash",
      "keyEnv": "DEEPSEEK_API_KEY",
      "allowedModels": ["deepseek-v4-pro", "deepseek-v4-flash"]
    },
    "openai": {
      "endpoint": "https://api.openai.com/v1/chat/completions",
      "model": "gpt-5.2",
      "flashModel": "gpt-5.2-mini",
      "keyEnv": "OPENAI_API_KEY",
      "allowedModels": ["gpt-5.2", "gpt-5.2-mini"]
    },
    "qwen": {
      "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      "model": "qwen3-max",
      "flashModel": "qwen3-turbo",
      "keyEnv": "QWEN_API_KEY",
      "allowedModels": ["qwen3-max", "qwen3-turbo"]
    }
  },
  "custom": {
    "endpoint": "https://api.siliconflow.cn/v1",
    "model": "deepseek-ai/DeepSeek-V4-Flash",
    "keyEnv": "CUSTOM_API_KEY"
  },
  "fallback": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash"
  }
}
```

### 字段说明

| 块 | 字段 | 说明 |
| --- | --- | --- |
| `providers.<name>` | `endpoint` | 内置供应商上游端点 |
| | `model` / `flashModel` | 默认（高质量）模型 / 轻量模型（简单任务自动降级省成本） |
| | `keyEnv` | 密钥所在的**环境变量名**（仅名字，非值） |
| | `allowedModels` | 服务端模型白名单（防恶意构造 body 触发计费） |
| `custom` | `endpoint` | 第三方 API 的 Base URL（自动补 `/chat/completions`）或完整 URL |
| | `model` | 平台上的模型 ID（大小写必须完全一致） |
| | `keyEnv` | 自定义密钥的环境变量名（默认 `CUSTOM_API_KEY`） |
| `fallback` | `provider` | 兜底供应商，仅 `deepseek` / `openai` / `qwen`（不能 `custom`） |
| | `model` | 兜底模型 ID |

### 派生关系（为何它是单一配置源）

| 消费方 | 派生内容 |
| --- | --- |
| `vite.config.ts`（构建时） | 注入 `VITE_CUSTOM_API_ENDPOINT` / `VITE_CUSTOM_MODEL` / `VITE_FALLBACK_AI_PROVIDER` / `VITE_FALLBACK_MODEL` |
| `server/src/index.ts`（启动时） | 派生 `CUSTOM_API_ENDPOINT` / `CUSTOM_MODELS`（`.env` 显式值优先） |
| `server/src/ai-proxy.ts`（UPSTREAMS） | 派生各供应商 `endpoint` / `keyEnv` / `allowedModels` |

> 新增供应商或调整端点 / 模型 / 白名单：**只改这一个文件**，重建前端 + 重启服务端即可生效。

***

## 二、配置自定义 API（OpenAI 兼容）要改哪些

### 第 1 步：地址 + 模型 → `config/ai-providers.json` 的 `custom`

```json
{
  "custom": {
    "endpoint": "https://openrouter.ai/api/v1",
    "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "keyEnv": "CUSTOM_API_KEY"
  }
}
```

### 第 2 步：密钥 → 服务端 `.env`

```
CUSTOM_API_KEY=sk-xxxx
```

> 变量名 `CUSTOM_API_KEY` 由 JSON 的 `custom.keyEnv` 声明，实际值写在这里。密钥仅服务端持有，不进前端 bundle。

### 第 3 步（可选）：开启自定义优先 → `.env.production` / `.env`

```
VITE_AI_PROVIDER=custom
```

> 不设置时，只要 `custom.endpoint` + `custom.model` 均已填写，前端会**自动检测**并启用 custom（见 `src/shared/services/ai/index.ts` 的 `isCustomEnvConfigured`），显式设置更直观。

配置完成后重建前端（`npm run build`）+ 重启服务端。

***

## 三、修改兜底 API 要改哪些

### 只改 `config/ai-providers.json` 的 `fallback`

```json
{
  "fallback": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash"
  }
}
```

兜底供应商对应的密钥写服务端 `.env`（变量名即该供应商在 `providers` 中的 `keyEnv`）：

| 兜底 `provider` | 需配置的密钥 |
| --- | --- |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `qwen` | `QWEN_API_KEY` |

> 通常保持默认 `deepseek` 即可零改动；只有换成 openai / qwen 时才需在服务端 `.env` 补对应密钥。

***

## 四、修改内置供应商（deepseek / openai / qwen）要改哪些

| 想改什么 | 文件 | 字段 |
| --- | --- | --- |
| 端点 / 默认模型 / 轻量模型 / 白名单 | `config/ai-providers.json` | `providers.<name>` 对应字段 |
| 密钥 | 服务端 `.env` | `providers.<name>.keyEnv` 对应的变量（如 `DEEPSEEK_API_KEY`） |

***

## 五、配置优先级链（运行时）

```
个人中心用户设置（localStorage / secureStorage，运行时热切换，最高优先级）
  > 环境变量（VITE_AI_PROVIDER、VITE_CUSTOM_* 构建注入；服务端 *_API_KEY）
  > config/ai-providers.json 默认值
  > 内置默认（deepseek）
```

- 用户在「个人中心 → AI 设置」配置供应商 / 密钥 / 端点后**即时生效**（无需重建、无需刷新），优先级最高。
- 自定义 API 调用失败时，`FallbackAIProvider` 自动切换到兜底供应商（见 [ARCHITECTURE.md](./ARCHITECTURE.md) 5.7 节）。

***

## 六、安全须知

1. **切勿把密钥值写进 `config/ai-providers.json`** —— 该文件可能进入版本库，只存变量名（`keyEnv`）。
2. **`VITE_*_API_KEY` 生产环境留空** —— `VITE_` 前缀变量会打进前端产物公开可见，仅供开发直连模式使用。
3. **密钥值统一写服务端 `.env`**（已被 `.gitignore` 忽略），由服务端代理持有。
4. **个人中心用户密钥经 secureStorage（AES-GCM）加密**存储在本地浏览器，不上传服务器。

***

## 七、一句话总结

| 想改什么 | 文件 | 字段 |
| --- | --- | --- |
| 自定义模型地址 / 模型 | `config/ai-providers.json` | `custom.endpoint` / `custom.model` |
| 自定义模型密钥 | 服务端 `.env` | `CUSTOM_API_KEY`（变量名来自 `custom.keyEnv`） |
| 开启自定义优先 | `.env.production` / `.env` | `VITE_AI_PROVIDER=custom`（或依赖自动检测） |
| 兜底供应商 / 模型 | `config/ai-providers.json` | `fallback.provider` / `fallback.model` |
| 兜底供应商密钥 | 服务端 `.env` | `DEEPSEEK_API_KEY` 等（按 provider 对应） |
| 内置供应商地址 / 模型 / 白名单 | `config/ai-providers.json` | `providers.<name>` |
| 内置供应商密钥 | 服务端 `.env` | `providers.<name>.keyEnv` 对应变量 |
