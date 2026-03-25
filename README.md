# AnnSight 数据全流程管理系统

> AI 优先 + 人工抽检模式的数据处理流水线

**版本**: v2.0
**状态**: ✅ 核心功能已完成 + 优化改进完成
**最后更新**: 2026-03-26

---

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 创建数据库
node scripts/create-db.js

# 运行迁移
node scripts/migrate.js

# 启动服务
npm start

# 访问系统
http://localhost:3000
```

---

## 📋 系统功能

### 新增功能 (v2.0 - 2026-03-26)

**🔐 认证授权**:
- JWT Token 验证
- 用户管理（创建、删除、密码修改）
- 管理员权限控制

**📢 消息通知**:
- 钉钉机器人通知
- 飞书机器人通知
- 审核完成自动通知
- 待办事项提醒

**📊 状态机管理**:
- 统一状态流转控制
- 状态转换验证
- 进度跟踪器

**📝 日志系统**:
- Winston 多级别日志
- 错误日志、访问日志分离
- 控制台彩色输出

### 4 个核心页面

| 页面 | URL | 功能 |
|------|-----|------|
| 📊 数据审核 | `/` | 低置信度数据审核，支持快捷键 (A/R/S) 和批量操作 |
| 📁 源数据管理 | `/raw-data.html` | 源数据 CRUD、批量上传、详情查看 |
| 📈 统计看板 | `/stats.html` | 实时统计、分布图表、审核进度 |
| 🔍 人工抽检 | `/spotcheck.html` | AI 准确率验证、分层抽样、批量修正 |

### 21+ 个 API 端点

**认证授权** (`/api/auth/*`):
- `POST /login` - 用户登录
- `GET /me` - 获取当前用户
- `POST /change-password` - 修改密码
- `POST /users` - 创建用户（管理员）
- `GET /users` - 用户列表（管理员）
- `DELETE /users/:username` - 删除用户（管理员）

**源数据管理** (`/api/raw-data/*`):
- `GET /stats` - 统计数据
- `GET /list` - 列表查询
- `POST /batch-text` - 批量上传（支持 AI 审核配置）
- `GET /:id` - 详情
- `DELETE /:id` - 删除
- `PATCH /:id/status` - 更新状态
- `POST /:id/review` - 第一级审核
- `POST /:batchId/ai-review/start` - 启动 AI 审核
- `GET /:batchId/manual-review/list` - 获取待人工审核列表
- `POST /:id/manual-review` - 提交人工审核
- `POST /:id/manual-review/optimize` - 人工优化
- `POST /:batchId/notify/manual-review` - 发送待办通知
- `GET /:id/review-rounds` - 获取审核轮次
- `GET /:batchId/feedback-logs` - 获取反馈日志

**数据审核** (`/api/review/*`):
- `GET /processed/low-confidence` - 低置信度数据
- `POST /processed/auto-approve` - AI 自动通过
- `POST /processed/decide` - 人工审核
- `GET /processed/spot-check/stratified` - 分层抽样
- `POST /processed/spot-check/correct` - 修正样本
- `POST /processed/batch-correct` - 批量修正
- `GET /processed/ready-for-rag` - 可同步 Dify
- `GET /stats/summary` - 统计摘要
- `GET /stats/ai-accuracy` - AI 准确率
- `GET /stats/distribution` - 分布统计
- `GET /stats/detailed` - 详细统计

**ETL 处理** (`/api/etl/*`):
- `POST /process-text` - 处理文本
- `POST /process-raw-data` - 处理源数据
- `POST /process-batch` - 批量处理

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                     前端页面层                            │
│  (index.html | raw-data.html | stats.html | spotcheck.html)│
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                     Express.js 路由层                     │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                   Repository 数据访问层                   │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                     PostgreSQL 数据库                    │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 数据处理流程

```
源数据上传 → ETL 处理 (L1 清洗 → L2 结构化 → L3 评估 → 去重)
              ↓
        加工数据生成
              ↓
    ┌─────────┴─────────┐
    ↓                   ↓
高置信度 (≥0.8)      低置信度 (<0.8)
    ↓                   ↓
AI 自动通过 + 冷却期    人工详细审核
    ↓                   ↓
    └─────────┬─────────┘
              ↓
        人工抽检 (5-10%)
              ↓
    ┌─────────┴─────────┐
    ↓                   ↓
Dify RAG 知识库      阿里百炼微调数据集
```

---

## 📚 文档

- **[优化总结](docs/OPTIMIZATION_SUMMARY.md)** - v2.0 优化改进详情
- **[通知服务](docs/NOTIFICATION_SERVICE.md)** - 钉钉/飞书通知配置
- **[状态机管理](docs/STATE_MACHINE.md)** - 审核状态流转管理

---

## ✅ 测试验证

### UAT 测试结果
- **ETL Pipeline**: 5/5 通过 ✅
- **全流程测试**: 8/8 通过 ✅
- **总通过率**: 100% ✅

### 运行测试
```bash
# 全流程 UAT 测试
npm run test:full-uat

# ETL Pipeline 测试
npm run test:uat
```

---

## 📁 项目结构

```
annsight-data-manager/
├── src/
│   ├── index.js                    # 主入口
│   ├── routes/
│   │   ├── review.js               # 审核路由
│   │   ├── raw-data.js             # 源数据路由
│   │   └── etl.js                  # ETL 路由
│   ├── repository/
│   │   ├── ProcessedDataRepository.js
│   │   └── RawDataIndexRepository.js
│   └── pipeline/
│       ├── etl-service.js
│       └── data-pipeline.js
├── public/
│   ├── index.html                  # 数据审核
│   ├── raw-data.html               # 源数据管理
│   ├── stats.html                  # 统计看板
│   └── spotcheck.html              # 人工抽检
├── scripts/
│   ├── create-db.js                # 数据库创建
│   └── migrate.js                  # 迁移运行
├── tests/
│   └── uat/
│       ├── test-etl-pipeline-uat.js
│       └── test-full-pipeline-uat.js
├── package.json
├── FEATURES.md                     # 功能清单
├── PROJECT-COMPLETION.md           # 项目总结
└── SYSTEM-VERIFICATION.md          # 验证报告
```

---

## 🔧 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Express.js + Node.js |
| 数据库 | PostgreSQL 14+ |
| 前端 | 原生 HTML/CSS/JavaScript |
| 测试 | Playwright + Jest |

---

## 📝 环境配置

### 环境变量
创建 `.env` 文件：
```env
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=annsight
DB_USER=postgres
DB_PASSWORD=postgres

# 服务器配置
PORT=3000
```

---

## 📋 数据库迁移

运行迁移创建表结构：
```bash
node scripts/migrate.js
```

迁移会创建以下表：
- `users` - 用户表
- `raw_data_index` - 原始数据索引
- `processed_data` - 加工数据
- `review_logs` - 审核日志
- `fingerprint_index` - 指纹库

---

## 🎯 核心特性

1. **AI 优先审核** - 高置信度数据自动通过，减少人工工作量
2. **分层抽样** - 验证 AI 准确性，发现系统性偏差
3. **批量修正** - 发现 AI 错误时可批量修正分类
4. **实时统计** - 多维度数据可视化，30 秒自动刷新
5. **快捷键支持** - A=通过，R=拒绝，S=跳过
6. **冷却期机制** - AI 自动通过数据需等待 24 小时才同步

---

## ⏳ 待开发功能

- [ ] 真实 LLM 集成（当前使用 Mock）
- [ ] Dify 同步前端集成
- [ ] MinHash 语义去重
- [ ] JWT 认证系统
- [ ] 统计看板趋势图表
- [ ] Excel/CSV 批量导入

---

## 📄 文档

- [功能清单](./FEATURES.md) - 详细功能列表
- [项目总结](./PROJECT-COMPLETION.md) - 完成情况总结
- [验证报告](./SYSTEM-VERIFICATION.md) - 系统验证结果

---

## 🚀 下一步

1. **接入真实 LLM API** - 替换 Mock 服务，获得准确的 AI 分类
2. **完成 Dify 同步前端** - 支持手动触发同步和状态查看
3. **冷启动校准** - 首批 500 条全人工标注，校准阈值

---

**访问地址**: http://localhost:3000

**默认用户**: admin（开发模式无需密码）

---

*最后更新：2026-03-21*
