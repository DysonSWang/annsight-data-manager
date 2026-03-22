# AnnSight 数据全流程管理系统 - 功能清单

**版本**: v1.0
**更新日期**: 2026-03-21
**状态**: 核心功能已完成

---

## 📊 系统概览

AnnSight 是一个完整的数据处理流水线系统，用于社交情商训练平台的数据采集、处理、管理，最终输出到 Dify RAG 知识库和阿里百炼微调数据集。

**访问地址**: http://localhost:3000

---

## ✅ 已完成功能

### 1. 源数据管理

**后端 API** (`/api/raw-data/*`):
- [x] `GET /api/raw-data/stats` - 获取源数据统计
- [x] `GET /api/raw-data/list` - 获取源数据列表（支持分页/筛选）
- [x] `POST /api/raw-data/batch-text` - 批量文本上传
- [x] `GET /api/raw-data/:id` - 获取单条源数据详情
- [x] `DELETE /api/raw-data/:id` - 删除源数据
- [x] `PATCH /api/raw-data/:id/status` - 更新源数据状态
- [x] `POST /api/raw-data/:id/review` - 第一级审核（通过/拒绝）

**前端页面** (`/raw-data.html`):
- [x] 统计数据展示（总数/待处理/已处理/批次数）
- [x] 数据列表（分页/筛选/搜索）
- [x] 批量上传模态框
- [x] 详情查看（含关联加工数据）
- [x] 快捷操作（处理/标记重复/删除）

### 2. ETL 处理管道

**核心流程**:
- [x] L1 清洗：HTML 去除/emoji 清理/水印去除
- [x] L2 结构化：自动分类/标签提取
- [x] L3 评估：完整性评分/质量评分
- [x] 去重检测：MD5 完全重复检测

**后端 API** (`/api/etl/*`):
- [x] `POST /api/etl/process-text` - 处理纯文本
- [x] `POST /api/etl/process-raw-data` - 处理源数据
- [x] `POST /api/etl/process-batch` - 批量处理

**服务类**:
- [x] `EtlService` - ETL 服务封装
- [x] `DataPipeline` - 数据处理管道
- [x] `MockLlmService` - Mock LLM 服务（开发测试用）

### 3. 数据审核平台

**后端 API** (`/api/review/*`):
- [x] `GET /api/review/processed/low-confidence` - 获取低置信度待审核数据
- [x] `POST /api/review/processed/auto-approve` - AI 自动通过高置信度数据
- [x] `POST /api/review/processed/decide` - 人工审核决策（通过/拒绝）
- [x] `GET /api/review/processed/spot-check/stratified` - 获取分层抽样样本
- [x] `POST /api/review/processed/spot-check/correct` - 修正单个样本
- [x] `POST /api/review/processed/batch-correct` - 批量修正 AI 分类错误
- [x] `GET /api/review/processed/ready-for-rag` - 获取可同步 Dify 的数据
- [x] `GET /api/review/stats/summary` - 获取统计摘要
- [x] `GET /api/review/stats/ai-accuracy` - AI 准确率统计
- [x] `GET /api/review/stats/threshold-recommendation` - 阈值动态调整建议
- [x] `GET /api/review/stats/distribution` - 数据分布统计（按类型/分类/来源）
- [x] `GET /api/review/stats/detailed` - 详细统计数据

**前端页面** (`/` - 数据审核):
- [x] 统计数据卡片（待审核/已通过/已拒绝）
- [x] 数据列表（分页/筛选）
- [x] 审核面板（内容展示/分类标签/置信度）
- [x] 快捷审核（A=通过/R=拒绝/S=跳过）
- [x] 批量操作（批量通过/批量拒绝）
- [x] 批量上传入口

### 4. 统计看板

**前端页面** (`/stats.html`):
- [x] 核心统计（总数/待审核/已通过/已拒绝）
- [x] AI 准确率统计（准确率/自动通过数/可同步 Dify 数）
- [x] 数据类型分布（教训案例/技巧方法/理论知识等）
- [x] 数据分类分布（职场/社交/情感/家庭/自我成长）
- [x] 批次处理统计（各批次数据量）
- [x] 源数据统计（总数/待处理/已处理/批次数）
- [x] 审核进度条（可视化展示）
- [x] 自动刷新（30 秒间隔）

**API 支持**:
- [x] `GET /api/review/stats/distribution?type=type|category|source` - 分布数据
- [x] `GET /api/review/stats/detailed` - 详细统计

### 5. 人工抽检

**前端页面** (`/spotcheck.html`):
- [x] AI 准确率统计卡片
- [x] 分层抽样展示（按类型分组）
- [x] 样本详情（类型/分类/置信度/内容）
- [x] 在线修正（类型修正/分类修正）
- [x] 批量修正模态框
- [x] 重新抽样功能

**API 支持**:
- [x] 分层抽样查询
- [x] 单个修正
- [x] 批量修正

### 6. 数据库设计

**核心表**:
- [x] `users` - 用户表
- [x] `raw_data_index` - 原始数据索引表
- [x] `processed_data` - 加工数据表
- [x] `review_logs` - 审核日志表
- [x] `fingerprint_index` - 指纹库（LSH 持久化）

**特性**:
- [x] 外键约束（reviewed_by → users）
- [x] JSONB 字段（tags/conversation/metadata）
- [x] 复合索引（低置信度查询优化）
- [x] 软删除（deleted_at 字段）
- [x] 冷却期机制（cooling_until）

### 7. 测试体系

**UAT 测试**:
- [x] ETL Pipeline 测试 (5/5 通过)
  - etl-001: 处理纯文本并提取结构化数据
  - etl-002: MD5 去重检测
  - etl-003: 处理不存在的原始数据
  - etl-004: 长文本处理与质量评估
  - etl-005: 战术方法类型识别

- [x] 全流程 UAT 测试 (8/8 通过)
  - FULL-001: 源数据批量上传
  - FULL-002: 源数据列表展示
  - FULL-003: 加工数据自动生成
  - FULL-004: 数据审核通过
  - FULL-005: 数据审核拒绝
  - FULL-006: 批量审核操作
  - FULL-007: 统计数据验证
  - FULL-008: 前端界面交互测试

**测试命令**:
```bash
npm run test:full-uat      # 全流程 UAT 测试
npm run test:uat           # ETL Pipeline 测试
```

---

## ⏳ 待开发功能

### 高优先级
- [ ] Dify 同步前端集成
  - [ ] Dify 同步状态展示
  - [ ] 手动触发同步
  - [ ] 同步日志查看

- [ ] 真实 LLM 集成
  - [ ] 替换 MockLlmService 为真实 API
  - [ ] 支持多模型配置
  - [ ] logprobs 置信度提取

### 中优先级
- [ ] MinHash 语义去重
  - [ ] ESM 模块兼容性修复
  - [ ] LSH 持久化实现
  - [ ] 指纹库重建脚本

- [ ] 认证系统（JWT）
  - [ ] 用户登录/注册
  - [ ] Token 验证中间件
  - [ ] 角色权限控制

### 低优先级
- [ ] 统计看板增强
  - [ ] 趋势图表（Chart.js 集成）
  - [ ] 导出 CSV/Excel
  - [ ] 自定义时间范围

- [ ] 批量导入功能
  - [ ] Excel/CSV 文件上传
  - [ ] 文件解析验证
  - [ ] 批量导入进度追踪

---

## 📦 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Express.js + Node.js |
| 数据库 | PostgreSQL 14+ |
| 前端 | 原生 HTML/CSS/JavaScript |
| 测试 | Playwright + Jest |
| 部署 | Docker Ready |

---

## 🚀 快速启动

```bash
# 1. 创建数据库
node scripts/create-db.js

# 2. 运行迁移
node scripts/migrate.js

# 3. 启动服务
npm start

# 4. 访问系统
http://localhost:3000
```

---

## 📄 页面导航

| 页面 |  URL | 功能 |
|------|------|------|
| 数据审核 | `/` | 低置信度数据审核 |
| 源数据管理 | `/raw-data.html` | 源数据 CRUD + 批量上传 |
| 统计看板 | `/stats.html` | 实时统计 + 分布图表 |
| 人工抽检 | `/spotcheck.html` | AI 准确率验证 + 修正 |

---

## 📊 核心 API

### 源数据管理
```
GET    /api/raw-data/stats          # 统计数据
GET    /api/raw-data/list           # 列表查询
POST   /api/raw-data/batch-text     # 批量上传
GET    /api/raw-data/:id            # 详情
DELETE /api/raw-data/:id            # 删除
PATCH  /api/raw-data/:id/status     # 更新状态
POST   /api/raw-data/:id/review     # 第一级审核
```

### 数据审核
```
GET    /api/review/processed/low-confidence      # 低置信度数据
POST   /api/review/processed/auto-approve        # AI 自动通过
POST   /api/review/processed/decide              # 人工审核
GET    /api/review/processed/spot-check/stratified # 分层抽样
POST   /api/review/processed/spot-check/correct  # 修正样本
POST   /api/review/processed/batch-correct       # 批量修正
GET    /api/review/processed/ready-for-rag       # 可同步 Dify
GET    /api/review/stats/summary                 # 统计摘要
GET    /api/review/stats/ai-accuracy             # AI 准确率
GET    /api/review/stats/distribution            # 分布统计
GET    /api/review/stats/detailed                # 详细统计
```

### ETL 处理
```
POST   /api/etl/process-text        # 处理文本
POST   /api/etl/process-raw-data    # 处理源数据
POST   /api/etl/process-batch       # 批量处理
```

---

## ✅ 验证状态

**系统验证报告**: [SYSTEM-VERIFICATION.md](./SYSTEM-VERIFICATION.md)

**UAT 测试报告**: [tests/uat/FULL-UAT-REPORT.html](./tests/uat/FULL-UAT-REPORT.html)

**最近验证时间**: 2026-03-21 17:00
**验证结果**: 13/13 测试通过 (100%)

---

*最后更新：2026-03-21*
