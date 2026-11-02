## 变更说明

<!-- 简述本次 PR 做了什么、为什么做。关联 issue 用 #123 引用。 -->

## 变更类型

- [ ] 功能新增（feat）
- [ ] 缺陷修复（fix）
- [ ] 重构（refactor，行为不变）
- [ ] 文档（docs）
- [ ] 测试（test）
- [ ] 工程化/CI（chore）

## 影响范围

- [ ] 前端（src/）
- [ ] 服务端（server/）
- [ ] 数据库 schema / 迁移
- [ ] 部署 / 运维
- [ ] 文档（docs/）

## 测试

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 0 error
- [ ] `npm test`（前端）通过
- [ ] `npm --prefix server test`（服务端）通过
- [ ] `npm run build` 通过
- [ ] `npm run docs:verify` + `npm run i18n:check` 通过
- [ ] 新增功能带对应测试

## 检查清单

- [ ] 未硬编码中文到组件（文案走 `useTranslation`，zh 值与原值逐字一致）
- [ ] 未提交密钥 / `.env` / 敏感信息
- [ ] 文档数值（测试数、表数）如变更已同步并通过 `npm run docs:verify`
- [ ] 面向用户的文案变更已同步 `zh-CN.json` 与 `en-US.json`
