# 智谱 AI 配置指南

## 获取 API Key

1. 访问 [智谱 AI 开放平台](https://open.bigmodel.cn/)
2. 注册/登录账号
3. 进入「API 管理」→「创建 API Key」
4. 复制 API Key 到配置文件

## 配置方法

编辑 `.env` 文件：

```bash
# 智谱 AI API 配置（用于数据优化）
ZHIPU_API_KEY=your-actual-api-key-here
ZHIPU_MODEL=glm-4
```

## 支持的模型

| 模型 | 说明 | 推荐场景 |
|------|------|----------|
| `glm-4` | 智谱最新旗舰模型 | 复杂任务、高质量要求 |
| `glm-3-turbo` | 高性价比模型 | 简单任务、批量处理 |
| `glm-4-flash` | 快速响应模型 | 实时交互场景 |

## 测试优化功能

### 方式一：前端界面
1. 访问 http://localhost:3000
2. 选择一条待审核数据
3. 点击"✨ 优化"按钮（或按 `O` 键）
4. 输入优化要求
5. 等待智谱 AI 生成优化建议
6. 预览并应用优化

### 方式二：API 测试
```bash
# 发送优化请求
curl -X POST http://localhost:3000/api/review/processed/{id}/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "requirements": "请将内容调整得更加具体，添加实际案例"
  }'
```

### 方式三：运行测试脚本
```bash
node tests/uat/v4/test-optimize.js
```

## 计费说明

- 智谱 AI 按 token 计费
- glm-4: 约 0.01 元/千 tokens
- glm-3-turbo: 更便宜
- 具体价格请参考官网

## 常见问题

### Q: API 调用失败
A: 检查以下几点：
1. API Key 是否正确配置
2. 网络连接是否正常
3. API Key 是否有余额

### Q: 响应速度慢
A: 可以尝试切换到 `glm-4-flash` 模型

### Q: 优化效果不理想
A: 尝试：
1. 在优化要求中更具体地描述需求
2. 切换到更强的模型（glm-4）
3. 提供更多原始数据上下文

---

**配置完成时间**: 2026-03-22
**集成模型**: 智谱 AI (Zhipu) glm-4
