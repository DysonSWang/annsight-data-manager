# 基于原理的裂变 - 经验固化

## 核心理念

**裂变不是硬编码场景映射，而是从故事中提取原理，再用原理驱动场景生成。**

流程：`故事 → 提取原理 → 应用到不同场景 → 生成裂变数据`

---

## 原理提取逻辑

### 故事分析维度

分析故事内容的关键元素，提取背后的原理：

| 关键元素 | 提取的原理 | 说明 |
|---------|-----------|------|
| 说"不要"+对方主动给予 | **以退为进** | 表面退让，实际激发对方主动 |
| 不直接说意图+巧妙方式 | **间接沟通** | 不直接表达，让对方自己理解 |
| 暗示失去+促使行动 | **制造紧急感** | 让对方担心失去，立即行动 |

### 原理数据结构

```javascript
{
    name: '以退为进',
    description: '表面上说"不要"或退让，实际激发对方主动给予的意愿',
    keySteps: ['表达退让姿态', '制造情境让对方主动', '达到目的同时保全双方面子'],
    fromStory: '主角说"我不要"，反而让长辈主动追出来塞回红包'
}
```

---

## 场景类型（6 种）

| 场景类型 | 典型困境 | 应用原理示例 |
|---------|---------|-------------|
| **职场** | 领导加码工作，不想接但不好拒绝 | 以退为进 |
| **社交** | 朋友请求走后门，不想违反规定 | 间接沟通 |
| **家庭** | 亲戚催生，暂时不打算要 | 制造紧急感 |
| **情感** | 伴侣抱怨被冷落，但确实工作忙 | 以退为进 |
| **自我** | 想参加社交但害怕人多场合 | 间接沟通 |
| **亲子** | 孩子吵着买玩具，不想惯着 | 制造紧急感 |

---

## 代码实现

### 核心文件

`src/pipeline/processors/l25-fission.js`

### 关键方法

```javascript
// 1. 从故事中提取原理
extractPrinciplesFromStory(story) {
    const principles = [];
    // 分析故事关键元素
    const hasSayNo = story.includes('不要');
    const hasIndirectApproach = story.includes('喊');
    const hasUrgency = story.includes('急');

    // 提取原理
    if (hasSayNo && hasOtherPartyInitiative) {
        principles.push({
            name: '以退为进',
            description: '...',
            keySteps: [...],
            fromStory: '...'
        });
    }
    return principles;
}

// 2. 生成场景变体（确保 6 种场景均匀分布）
generateScenarioVariation(originalStory, variantIndex) {
    const principles = this.extractPrinciplesFromStory(originalStory);
    const scenarioTypeIndex = variantIndex % 6;  // 确保场景均匀分布
    const principleIndex = variantIndex % principles.length;

    const principle = principles[principleIndex];
    const template = scenarioTemplates[scenarioTypeIndex];

    return {
        scenario: this.generateScenarioFromPrinciple(principle, template.type),
        principle,
        type: template.type
    };
}

// 3. 根据原理生成场景化解决方案
generateScenarioSolution(scenario, principle, type) {
    const generators = {
        '以退为进': this.generateYituiweijinSolution.bind(this),
        '间接沟通': this.generateIndirectSolution.bind(this),
        '制造紧急感': this.generateUrgencySolution.bind(this)
    };
    const generator = generators[principle.name] || this.generateDefaultSolution.bind(this);
    return generator(scenario, principle, type);
}
```

---

## 使用方式

### 裂变配置

```javascript
fissionConfig: {
    finetuning: {
        count: 6,  // 生成 6 条，覆盖所有场景类型
        requirement: '同一理念，不同场景。从故事抽象出理念，应用到职场、社交、家庭、情感、自我、亲子等不同场景。'
    }
}
```

### 输出数据格式

```javascript
{
    type: '多轮对话',
    category: '情商',
    scenarioType: '职场',  // 场景类型
    conversation: [
        { role: 'user', content: '领导突然给我加码...' },
        {
            role: 'assistant',
            content: '<think>\n分析用户的问题...\n</think>\n\n**解决方案**：...'
        }
    ],
    appliedPrinciple: {
        name: '以退为进',
        description: '...',
        fromStory: '...'
    },
    principleSource: '主角说"我不要"...'
}
```

---

## 验证标准

### 场景分布验证

6 次裂变应该覆盖所有 6 种场景：
- 职场：1 条
- 社交：1 条
- 家庭：1 条
- 情感：1 条
- 自我：1 条
- 亲子：1 条

### 原理分布验证

提取的原理应该均匀应用：
- 以退为进：2 条
- 间接沟通：2 条
- 制造紧急感：2 条

### 对话格式验证

- ✓ conversation 字段存在且为数组
- ✓ 对话轮数 ≥ 2（user + assistant）
- ✓ 包含 user 消息
- ✓ 包含 assistant 消息
- ✓ assistant 回复包含 `<think></think>` 思考标签

---

## 全流程测试

### 测试步骤

1. 导入原始故事到数据库
2. 执行基于原理的裂变（生成 6 条）
3. 创建微调任务
4. 执行 AI 审核
5. 导出 SFT 格式数据
6. 验证场景分布和对话格式

### 测试命令

```bash
node test-full-workflow.js
```

---

## 关键经验

1. **场景均匀分布**：使用 `variantIndex % 6` 确保 6 次裂变覆盖不同场景
2. **原理循环使用**：使用 `variantIndex % principles.length` 循环应用提取的原理
3. **元数据存储**：将裂变信息编码到 conversation 的 system 消息中
4. **JSONB 处理**：PostgreSQL 的 jsonb 字段需要用 `JSON.stringify()` 处理
5. **查询 jsonb 数组**：使用 `jsonb_array_length()` 而非 `array_length()`

---

## 文件路径

| 文件 | 说明 |
|------|------|
| `src/pipeline/processors/l25-fission.js` | 裂变处理器核心逻辑 |
| `src/services/FinetuningExportService.js` | SFT 格式导出服务 |
| `src/routes/finetuning.js` | 微调任务 API |
| `src/prompts/finetuning-review.js` | AI 审核 Prompt（保护故事真实性） |
| `src/prompts/finetuning-optimize.js` | AI 优化 Prompt（保护故事真实性） |
