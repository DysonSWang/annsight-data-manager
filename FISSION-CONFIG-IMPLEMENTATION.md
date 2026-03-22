# 裂变配置功能实现文档

**版本**: v1.2
**更新日期**: 2026-03-22
**状态**: ✅ 已完成

---

## 功能概述

增强了裂变功能，支持：
1. **用途标签扩展**：新增"其他"（other）类别
2. **裂变开关**：启用/禁用裂变功能
3. **按用途配置**：每种用途可独立设置期望数量和要求说明

---

## 用户界面

### 前端新增元素

#### 1. 裂变开关
```html
<input type="checkbox" id="fission-enable">
<span>🔮 启用裂变</span>
```

#### 2. 用途选择（4 个选项）
- 📚 RAG 素材（默认选中）
- 🤖 微调数据（默认选中）
- ✍️ 内容创作
- 📌 其他（新增）

#### 3. 裂变配置面板（启用后显示）

每种用途包含：
- **期望数量**：数字输入（0-20）
- **要求说明**：文本域，作为 LLM 提示词

**示例配置**：
```
📚 RAG 素材
  期望数量：3
  要求说明：提取独立的知识点，每条 200-500 字，适合 RAG 检索

🤖 微调数据
  期望数量：2
  要求说明：生成多轮对话，2-4 轮，场景真实自然

✍️ 内容创作
  期望数量：2
  要求说明：提取金句、案例素材、选题方向

📌 其他
  期望数量：1
  要求说明：评估测试题、场景模拟题
```

---

## 数据流

### 前端 → 后端

**请求格式**：
```javascript
POST /api/raw-data/batch-text
{
    "texts": ["文本内容 1", "文本内容 2"],
    "batchId": "zhihu-2026-03-22",
    "source": "zhihu",
    "purposes": ["rag", "finetuning"],
    "fissionConfig": {
        "rag": {
            "count": 3,
            "requirement": "提取独立的知识点，每条 200-500 字"
        },
        "finetuning": {
            "count": 2,
            "requirement": "生成多轮对话，2-4 轮"
        },
        "content_creation": {
            "count": 2,
            "requirement": ""
        },
        "other": {
            "count": 1,
            "requirement": ""
        }
    }
}
```

### 后端 → Pipeline

**ETL Service 传递**：
```javascript
etlService.processText(text, {
    source,
    batchId,
    purposes: ['rag', 'finetuning'],
    fissionConfig: { ... } // 传递裂变配置
});
```

### Pipeline → L2.5 Processor

**上下文传递**：
```javascript
pipeline.execute({
    rawText: text,
    sourceType: 'upload',
    purposes: ['rag', 'finetuning'],
    fissionConfig // 传递到上下文
});
```

### L2.5 Processor → LLM Service

**调用参数**：
```javascript
llmService.analyzeForFission(cleanedText, {
    purposes: ['rag', 'finetuning'],
    sourceType: 'upload',
    fissionConfig // 传递给 LLM
});
```

---

## 代码修改汇总

### 1. 前端 (`public/raw-data.html`)

**HTML 结构**：
- ✅ 文本输入标签页：添加裂变开关和配置面板
- ✅ 文件上传标签页：添加裂变开关和配置面板
- ✅ 每种用途 4 个配置区块（RAG、微调、内容创作、其他）

**JavaScript 函数**：
- ✅ `getSelectedPurposes()` - 获取文本标签页选中的用途
- ✅ `getSelectedPurposesFile()` - 获取文件标签页选中的用途
- ✅ `getFissionConfig()` - 获取文本标签页裂变配置
- ✅ `getFissionConfigFile()` - 获取文件标签页裂变配置
- ✅ `switchUploadTab()` - 添加裂变面板事件监听
- ✅ `confirmUpload()` - 使用新的配置收集函数
- ✅ `uploadTexts()` - 发送裂变配置到后端

**事件监听**：
```javascript
// 裂变开关切换
fissionEnable.addEventListener('change', function(e) {
    fissionConfig.style.display = e.target.checked ? 'block' : 'none';
});
```

### 2. 后端 API (`src/routes/raw-data.js`)

**函数修改**：
- ✅ `batchTextUpload()` - 接收 `fissionConfig` 参数并传递给 ETL

**请求体解析**：
```javascript
const { texts, batchId, source, purposes, fissionConfig } = req.body;
```

### 3. ETL 服务 (`src/pipeline/etl-service.js`)

**函数修改**：
- ✅ `processText()` - 接收并传递 `fissionConfig` 到 Pipeline

**元数据处理**：
```javascript
const { purposes, fissionConfig } = metadata;
const result = await pipeline.execute({
    rawText: text,
    sourceType: metadata.source || 'upload',
    batchId: metadata.batchId || 'manual',
    purposes: purposes || ['rag'],
    fissionConfig
});
```

### 4. L2.5 裂变处理器 (`src/pipeline/processors/l25-fission.js`)

**处理器修改**：
- ✅ `process()` - 从上下文获取 `fissionConfig` 并传递给 LLM

**Mock LLM 服务修改**：
- ✅ `analyzeForFission()` - 根据配置的数量和要求生成数据
- ✅ 支持 4 种用途：rag, finetuning, content_creation, other
- ✅ 根据 `count` 配置生成对应数量的数据
- ✅ 将 `requirement` 添加到标题中（真实 LLM 将用于提示词）

**Mock 实现逻辑**：
```javascript
for (const purpose of purposes) {
    const config = fissionConfig[purpose] || {};
    const count = config.count || 1;
    const requirement = config.requirement || '';

    for (let i = 0; i < count; i++) {
        // 生成数据，将 requirement 加入标题
        items.push({...});
    }
}
```

### 5. 处理器注册表 (`src/pipeline/processors/index.js`)

**配置传递**：
```javascript
const fissionOptions = {
    purposes: options.purposes || ['rag', 'finetuning', 'content_creation']
};
'l25-fission': new L25FissionProcessor(llmFissionService, fissionOptions);
```

---

## 使用示例

### 示例 1：仅 RAG 素材（3 条）

**前端操作**：
1. 勾选"📚 RAG 素材"
2. 打开"🔮 启用裂变"
3. RAG 配置：期望数量=3，要求="知识点卡片"

**预期结果**：
- 1 条源数据 → 3 条 RAG 加工数据

### 示例 2：RAG + 微调（共 5 条）

**前端操作**：
1. 勾选"📚 RAG 素材"和"🤖 微调数据"
2. 打开"🔮 启用裂变"
3. RAG 配置：期望数量=3
4. 微调配置：期望数量=2

**预期结果**：
- 1 条源数据 → 3 条 RAG 数据 + 2 条微调数据 = 5 条

### 示例 3：不启用裂变

**前端操作**：
1. 可勾选任意用途
2. 关闭"🔮 启用裂变"

**预期结果**：
- 1 条源数据 → 1 条加工数据（传统模式）

---

## 数据库字段

**加工数据表 (`processed_data`)**：
```sql
purposes VARCHAR(64)  -- 逗号分隔的用途字符串
                          -- 示例：'rag', 'rag,finetuning', 'other'
```

**注意**：裂变配置（count/requirement）不存储到数据库，仅作为 LLM 提示词使用。

---

## LLM 提示词模板

### 真实 LLM 集成时的提示词结构

```
你是一个专业的数据分析师，负责将原始文本裂变成多条不同用途的高质量数据。

## 输入文本
{cleanedText}

## 任务要求

请分析上述文本，根据内容特点裂变成多条数据，根据以下配置生成：

### 📚 RAG 素材
- 期望数量：{ragConfig.count}
- 要求说明：{ragConfig.requirement}

### 🤖 微调数据
- 期望数量：{finetuningConfig.count}
- 要求说明：{finetuningConfig.requirement}

### ✍️ 内容创作素材
- 期望数量：{contentCreationConfig.count}
- 要求说明：{contentCreationConfig.requirement}

### 📌 其他
- 期望数量：{otherConfig.count}
- 要求说明：{otherConfig.requirement}

## 输出格式

```json
{
  "items": [
    {
      "type": "知识卡片 | 教训案例 | 战术方法 | 沟通技巧 | 多轮对话 | 创作素材",
      "category": "职场 | 情感 | 家庭 | 社交 | 学习 | 自我",
      "title": "简洁的标题（≤50 字）",
      "content": "内容主体",
      "purposes": ["rag"],
      "tags": ["标签 1", "标签 2"],
      "aiConfidenceScore": 0.92
    }
  ]
}
```

请严格按照 JSON 格式输出。
```

---

## 测试验证

### 测试命令

```bash
# 1. 启动服务器
npm start

# 2. 访问前端页面
http://localhost:3000/raw-data.html

# 3. 测试裂变上传
# - 点击"批量上传"
# - 打开"🔮 启用裂变"
# - 配置各用途数量和要求
# - 上传文本并处理

# 4. 查看结果
# - Toast 提示："上传完成：成功 X/X（裂变 Y 条加工数据）"
# - 访问统计看板查看类型分布
```

### 预期行为

1. **裂变开关关闭**：
   - 配置面板隐藏
   - 1 条源数据 → 1 条加工数据

2. **裂变开关开启**：
   - 配置面板显示
   - 1 条源数据 → N 条加工数据（N = 各用途 count 之和）

3. **用途选择**：
   - 选中"其他"时，生成 `purposes: ['other']` 的数据

---

## 下一步优化

1. **真实 LLM 集成**：
   - 替换 `MockLlmServiceForFission` 为真实 LLM API
   - 使用要求说明构建提示词

2. **配置验证**：
   - 前端检查 count 总和不超过限制（如 20）
   - 后端验证配置格式

3. **性能优化**：
   - 大批量裂变的异步队列处理
   - 并发 LLM 调用

4. **质量评分**：
   - 根据 LLM 输出质量评估裂变效果
   - 低质量数据标记

---

**功能已实现，可以开始使用！**
