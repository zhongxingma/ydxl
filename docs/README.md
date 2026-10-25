# 文档索引

`ydxl` 英语学习应用的完整文档目录。项目概览与快速开始见根目录 [README](../README.md)。

## 按用途查找

### 快速上手

| 文档 | 内容 |
| --- | --- |
| [README](../README.md) | 项目概述、功能特性、技术栈、快速开始、环境变量、故障排查 |
| [USER_GUIDE](./USER_GUIDE.md) | 面向最终用户的功能使用手册 |
| [DEPLOYMENT](./DEPLOYMENT.md) | 部署指南：本地开发、Linux 服务器部署、环境变量矩阵、构建产物 |
| [LINUX_DEPLOY](./LINUX_DEPLOY.md) | 实战 Linux 部署：Ubuntu 22.04 / Debian 12 逐步命令、PM2 / systemd、Nginx、SSL |

### 架构与设计

| 文档 | 内容 |
| --- | --- |
| [ARCHITECTURE](./ARCHITECTURE.md) | 分层架构、模块依赖图、数据流、AI Provider 抽象层设计 |
| [MULTI_USER_DESIGN](./MULTI_USER_DESIGN.md) | 多用户架构方案（P0 认证隔离、P1 RBAC 用户管理、P2 审计日志、P3 加固与运营均已实施）：数据隔离、RBAC 权限、审计日志、并发与安全、迁移与分阶段实施 |
| [DATABASE](./DATABASE.md) | 数据库设计：SQLite 12 张表 + Dexie 8 张表的字段、索引、多用户迁移、加密 |
| [ER_DIAGRAM](./ER_DIAGRAM.md) | 数据表实体关系图（Mermaid） |
| [TECHNICAL_ANALYSIS](./TECHNICAL_ANALYSIS.md) | 技术分析：SM-2 算法、存储架构、退避重试、PWA 缓存策略 |

### 接口与配置

| 文档 | 内容 |
| --- | --- |
| [API_REFERENCE](./API_REFERENCE.md) | REST API（含 /api/auth/* 认证端点）、AI 代理端点、AIProvider 接口、Repository、核心数据类型 |
| [AI_API_CONFIGURATION](./AI_API_CONFIGURATION.md) | AI 供应商统一配置：`config/ai-providers.json` 单一注册表速查 |
| [CACHING](./CACHING.md) | AI 响应缓存（内存 LRU + IndexedDB）与 Dexie 缓存策略 |

### 运维与质量

| 文档 | 内容 |
| --- | --- |
| [OPERATIONS](./OPERATIONS.md) | 运维手册：性能基线、日志、SQLite 备份、监控、升级、安全审计 |
| [SECURITY](../SECURITY.md) | 安全政策：当前安全机制、已知边界与取舍、漏洞报告渠道 |
| [TESTING](./TESTING.md) | 测试策略与 vitest 配置（前端 62 文件 / 后端 18 文件）+ Playwright E2E（阅读 / 复习 / 离线回退 / 生词本 / 打印 / 多用户切换 / 生产 SW） |
| [UPGRADE](./UPGRADE.md) | 版本升级指引（含 Dexie schema 迁移说明） |
| [AI_TOKEN_OPTIMIZATION](./AI_TOKEN_OPTIMIZATION.md) | AI Token 成本优化 |

### 流程与规范

| 文档 | 内容 |
| --- | --- |
| [CODING_STANDARDS](./CODING_STANDARDS.md) | 开发规范：TypeScript / React / 数据层 / 安全 / AI Provider / 测试规范 |
| [CONTRIBUTING](../CONTRIBUTING.md) | 贡献指南：commit 规范、分支命名、PR 流程、Git hooks |
| [CHANGELOG](../CHANGELOG.md) | 版本变更记录 |
| [BUGLOG](../BUGLOG.md) | Bug 跟踪与管理日志 |

### 历史归档

以下文档为特定时间点的历史快照，内容不再随代码更新，仅供追溯：

| 文档 | 内容 |
| --- | --- |
| [REFACTOR_SUMMARY_2026-10-25](./archive/REFACTOR_SUMMARY_2026-10-25.md) | 本轮 P0/P1 加固、结构化重构与文档治理的变更摘要 |
| [PROJECT_ANALYSIS_REPORT](./archive/PROJECT_ANALYSIS_REPORT.md) | 历史项目分析报告（含问题修复记录快照） |
| [E2E_TEST_REPORT](./archive/E2E_TEST_REPORT.md) | 历史 E2E 测试总结报告 |
| [DOC_SYNC_SUMMARY_2026-10-18](./archive/DOC_SYNC_SUMMARY_2026-10-18.md) | 历史文档同步变更摘要 |

## 文档维护约定

- 代码行为变更时按 [CODING_STANDARDS 第 13 节](./CODING_STANDARDS.md#13-文档同步) 的对照表同步更新文档。
- 文档中的数值（超时、限流、测试数量、表数量）必须与代码一致，发现漂移随改随修。
- 新增文档请同时更新本索引与根 README 的文档表。
- 一次性报告、阶段性分析快照统一归档到 `docs/archive/`，不再在根目录或 `docs/` 顶层堆积。
