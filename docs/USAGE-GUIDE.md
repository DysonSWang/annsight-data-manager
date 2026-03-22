# AnnSight 数据审核平台 - 使用指南

## 🚀 快速开始

### 1. 启动服务器

```bash
cd /home/admin/projects/annsight-data-manager

# 开发模式（热重载）
npm run dev

# 或生产模式
npm start
```

服务器启动后访问：**http://localhost:3000**

---

## 📱 界面功能

### 数据审核页面

**访问地址**: http://localhost:3000

**功能说明**:
- 📋 **待审核列表**: 显示所有 AI 置信度低于 0.8 的数据
- 🔍 **审核详情**: 查看数据完整信息和 AI 分类结果
- ⌨️ **快捷键操作**:
  - `A` - 通过 (Approve)
  - `R` - 拒绝 (Reject)
  - `S` - 跳过 (Skip)

**操作流程**:
1. 从左侧列表选择一条待审核数据
2. 查看右侧详情面板的 AI 分类和质量评分
3. 如需修正分类，在下拉菜单中选择正确类型
4. 使用快捷键或点击按钮进行审核：
   - ✅ **通过**: 数据标记为 approved，冷却期后可同步到 Dify
   - ❌ **拒绝**: 需填写拒绝原因，数据标记为 rejected
   - ⏭️ **跳过**: 将数据移到列表末尾，继续下一条

---

## 🔌 API 接口

### ETL 处理 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/etl/process-text` | POST | 处理上传的文本 |
| `/api/etl/process-raw-data` | POST | 处理原始数据 |
| `/api/etl/process-batch` | POST | 批量处理数据 |

**示例**:
```bash
# 处理文本
curl -X POST http://localhost:3000/api/etl/process-text \
  -H "Content-Type: application/json" \
  -d '{"text": "这是一段测试文本", "metadata": {"source": "manual"}}'
```

### 审核平台 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/review/processed/low-confidence` | GET | 获取低置信度待审核数据 |
| `/api/review/processed/decide` | POST | 人工审核决定（批准/拒绝） |
| `/api/review/processed/auto-approve` | POST | AI 自动批准高置信度数据 |
| `/api/review/stats/summary` | GET | 获取统计数据 |
| `/api/review/stats/ai-accuracy` | GET | AI 准确率统计 |

**示例**:
```bash
# 获取待审核数据
curl http://localhost:3000/api/review/processed/low-confidence?page=1&pageSize=20

# 审核通过
curl -X POST http://localhost:3000/api/review/processed/decide \
  -H "Content-Type: application/json" \
  -d '{"id": "pd-123", "action": "approve"}'
```

---

## 📊 统计看板

访问 http://localhost:3000 后，顶部会显示实时统计：

| 指标 | 说明 |
|------|------|
| 待审核 | AI 置信度 < 0.8 的数据数量 |
| 已通过 | 人工审核通过的数据数量 |
| 已拒绝 | 人工拒绝的数据数量 |
| AI 准确率 | 基于抽检结果计算的准确率 |

---

## 🧪 UAT 测试

### 运行 UAT 测试

```bash
# 执行完整 UAT 测试（带截图）
npm run test:uat

# 查看测试报告
open tests/uat/UAT-REPORT.html
```

### 测试覆盖

| 测试项 | 状态 |
|--------|------|
| 处理纯文本并提取结构化数据 | ✅ |
| MD5 去重检测 | ✅ |
| 处理不存在的原始数据 | ✅ |
| 长文本处理与质量评估 | ✅ |
| 战术方法类型识别 | ✅ |

---

## ⚙️ 配置说明

### 环境变量 (.env)

```bash
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=annsight_data
DB_USER=postgres
DB_PASSWORD=postgres

# AI 置信度阈值
CONFIDENCE_THRESHOLD=0.8

# 冷却期（小时）
COOLING_HOURS=24

# 服务器端口
PORT=3000
```

---

## 🎯 完整工作流程

```
1. 数据采集
   ↓
2. ETL 处理 (L1 清洗 → L2 结构化 → L3 评估 → 去重)
   ↓
3. AI 自动批准 (置信度 ≥ 0.8) → 冷却期 24h → Dify 同步
   ↓
4. 人工审核 (置信度 < 0.8) → 审核平台 → 批准/拒绝
   ↓
5. 人工抽检 (5-10% 已通过数据) → 验证 AI 准确率
```

---

## 📸 界面预览

### 审核平台主界面

- **左侧**: 待审核数据列表（按置信度排序）
- **右侧**: 审核详情面板
  - 标题、内容预览
  - AI 分类结果（类型、分类、置信度）
  - 质量评分（完整性、真实性、综合）
  - 分类修正下拉菜单
- **底部**: 操作按钮 + 快捷键提示

---

## 🔧 故障排除

### 数据库连接失败

```bash
# 检查 PostgreSQL 是否运行
pg_isready

# 创建数据库
createdb annsight_data

# 运行迁移
npm run db:migrate
```

### 端口被占用

```bash
# 修改 .env 中的 PORT
PORT=3001
```

### API 响应 500 错误

检查日志输出，常见原因：
- 数据库表不存在 → 运行 `npm run db:migrate`
- 连接池耗尽 → 增加 `DB_POOL_MAX` 参数

---

## 📝 待开发功能

| 功能 | 状态 | 预计完成 |
|------|------|----------|
| 数据审核（低置信度） | ✅ 已完成 | - |
| 人工抽检 | 🚧 开发中 | - |
| 统计看板 | 🚧 开发中 | - |
| Dify 同步 | ✅ 后端完成 | 待前端集成 |
| 批量导入 | ❌ 未开始 | - |
| 数据导出（微调格式） | ✅ 后端完成 | 待前端集成 |

---

## 📞 技术支持

遇到问题请查看：
1. [项目 README](../../README.md)
2. [UAT 测试报告](tests/uat/UAT-REPORT.html)
3. [API 文档](src/routes/)

---

**最后更新**: 2026-03-21
