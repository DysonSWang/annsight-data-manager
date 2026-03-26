#!/usr/bin/env python3
"""
管道 3：SFT 微调数据提取 V9.0（分流器架构）
核心功能：
1. 复用 V11 的 3-Agent 流水线（提取→审核 + 打磨→格式化）
2. 只处理 A/B/F 型内容（公式教学型、话术演示型、问答技巧型）
3. 输出：sft_data.jsonl
"""

import json
import os
import asyncio
import aiohttp
from typing import Dict, List, Optional
from datetime import datetime

# ==================== 配置 ====================

API_KEY = "2ab244591853490484e9543bebe5619c.Xtm8jyApYTG7pYdl"
BASE_URL = "https://open.bigmodel.cn/api/paas/v4"

TRANSCRIPTS_ROOT = "/home/admin/projects/video-wisdom-dataset/transcripts"
OUTPUT_DIR = "/home/admin/projects/eq-trainning/t2"
CLASSIFIER_OUTPUT = os.path.join(OUTPUT_DIR, "classification_result.json")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "sft_data.jsonl")
REJECTED_FILE = os.path.join(OUTPUT_DIR, "sft_rejected.jsonl")

MAX_CONCURRENT_FILES = 10
MAX_RETRIES = 5
RETRY_DELAY = 2

# ==================== Agent Prompts ====================

def get_agent1_prompt(transcript_content: str, video_title: str, content_type: str) -> str:
    return f"""你是一个情商训练数据提取专家。请分析以下转录内容，提取 SFT 训练数据。

【视频标题】{video_title}
【内容类型】{content_type}

【转录内容】
{transcript_content}

【核心任务 - 应提尽提】
从转录中提取**所有可提取的问答对**（一个视频可以提取多条数据）：
1. 识别视频中的多个关键决策点/话题点/技巧点
2. 每个点提取一对匹配的问答：
   - 用户真的会问的问题（具体场景 + 真实情绪）
   - 专家针对这个问题的回复（必须真正回答问题）

【回答的强制要求（不满足就重写）】
每条答案必须同时满足以下四点，否则是垃圾数据：
1. **语气词**：必须使用至少 2-3 个语气词（哎呀、呢、哦、嘛、啦、呀、吧、啊等）
2. **场景感**：必须包含具体场景描述（比如...的时候、找个时机、假设等）
3. **具体话术**：必须有原话或步骤（1/2/3），不能是空泛建议
4. **思考过程**：必须是真思考，不是伪思考（详见下方模板）

【多轮提取策略 - 应提尽提】
根据视频内容复杂度，提取适当数量的问答对：
- 单一故事型：提取 1-2 条（识别关键决策点）
- 多个案例型：提取 2-4 条（每个案例 1 条）
- 技巧罗列型：提取 3-5 条（每个技巧 1 条）
- 心理学概念型：提取 2-3 条（概念 + 案例 + 方案）

【Few-shot 示例 - 学习这些正例】

━━━━━━━━━━ 示例 1：故事场景型 ━━━━━━━━━━
用户问题："被人冤枉了，对方事后发红包补偿，该不该收？怎么回复？"
思考过程：
  情绪识别：用户此刻感到委屈（情绪），因为自己的付出被误解成贪小便宜（触发点），但又怕拒绝红包显得不近人情（内心冲突）
  核心诉求：用户表面问"收不收"，实际想要的是：既维护尊严，又不让关系破裂
  策略分析：收红包但要重新定义用途→把"赔偿"转化为"合作"，这样对方不欠你，你也不委屈，还能变成长期关系
  潜在风险：注意如果对方持续不信任，需要考虑是否继续合作
专家答案："哎呀，这事儿确实挺让人头疼的。这样吧，这钱我收了，一部分拿去做个准备（比如买个监控留个凭证），剩下的就当下次合作的定金。这样大家都不委屈，还能继续合作嘛～"
━━━━━━━━━━

━━━━━━━━━━ 示例 2：金句型 ━━━━━━━━━━
用户问题："我总是情绪化地表达，对方总是回避，怎么办呀？"
思考过程：
  情绪识别：用户感到沮丧和无力（情绪），因为真诚表达却被推开（触发点），想要亲近却适得其反（内心冲突）
  核心诉求：用户表面问"怎么办"，实际想要的是：既能表达真实感受，又不会把对方越推越远
  策略分析：用"非暴力沟通"四步法（事实→感受→需要→请求），让对方听到用户的需求而不是指责，从而放下防御
  潜在风险：如果对方长期回避沟通，可能需要专业咨询介入
专家答案："其实吧，你可以试试非暴力沟通哦。比如这样说：'当你迟到半小时（事实），我感到有点失落（感受），因为我很重视我们的约定（需要），下次可以提前告诉我吗？（请求）'这样说对方更容易听进去呢～"
━━━━━━━━━━

━━━━━━━━━━ 示例 3：心理学型 ━━━━━━━━━━
用户问题："伴侣总是猜不透我的心思，是我表达有问题吗？"
思考过程：
  情绪识别：用户感到困惑和挫败（情绪），因为期待被理解却屡屡落空（触发点），开始怀疑自己（内心冲突）
  核心诉求：用户表面问"是不是我有问题"，实际想要的是：被看见、被理解，同时学会有效表达
  策略分析：揭示"读心术期待"的误区→明确表达需求不是"要来的"，而是教会对方如何爱自己
  潜在风险：避免陷入"我不说你也应该懂"的期待陷阱
专家答案："哎呀，这不是你的问题啦～很多人都有这个误区，觉得'真正爱我的人应该懂我'。但说实话，没有人能读心哦。你可以找个轻松的时机，比如说'我想要你抱抱我'这样直接表达，对方反而会觉得很被需要呢～"
━━━━━━━━━━

【输出格式】请输出 JSON 数组（每条是一个独立的问答对）：
[
  {{
    "content_type": "{content_type}",
    "question": "用户真的会问的问题",
    "answer": "专家答案（必须真正回答问题）",
    "principle": "原文中总结的道理/金句（如果没有则留空）",
    "thinking": "情绪识别：... 核心诉求：... 策略分析：... 潜在风险：...",
    "source_video": "{video_title}",
    "source_segment": "可选：视频中的具体片段/话题点"
  }},
  ...
]

【重要规则 - 答案中禁止包含元数据】
答案字段只包含专家回复内容，不要包含以下元数据：
- ❌ 不要在答案末尾添加"\n思考：..."
- ❌ 不要在答案末尾添加"\n道理：..."
- ❌ 不要在答案末尾添加"\n来源：..."
- ❌ 不要在答案末尾添加"\n类型：..."
- ✅ 答案应该只有对话内容，元数据应该放在对应的 JSON 字段中

示例：
❌ 错误答案："你可以这样说...（话术内容）\n思考：情绪识别：...\n道理：...\n来源：..."
✅ 正确答案："你可以这样说...（话术内容）"

【语义一致性要求（最重要）】
问题和答案必须语义匹配：
- ✅ 问题问"怎么安慰朋友"，答案讲"安慰的具体话术"
- ❌ 问题问"怎么帮朋友"，答案讲"感情试探技巧"（答非所问）

【问题要求 - 真实性检查】
- 必须是用户真的会问的（口语化、具体场景、有真实情绪）
- 不能是教科书式问题（如"如何有效沟通"）
- 不能是推广类问题（如"怎么下载 XXAPP"、"XX 在哪里"）
- 长度 10-50 字

【答案要求】
- 必须真正回答问题，不是答非所问
- 必须有具体话术或步骤（1/2/3）
- 不能是空泛建议（如"多沟通"）

【思考过程要求 - 真思考模板（重点！）】
必须包含以下 4 要素，缺一不可：
1. 情绪识别（具体情绪词 + 触发点 + 内心冲突）：
   ✅ "用户此刻感到委屈（情绪），因为自己的付出没有被看见（触发点），但又怕直接表达会显得小气（内心冲突）"
   ❌ "用户感到困扰"（太模糊）
2. 核心诉求（表面问题→真实需求）：
   ✅ "用户表面问'怎么办'，实际想要的是：既不被占便宜，又不破坏关系"
   ❌ "用户需要解决方案"（太笼统）
3. 策略分析（为什么有效）：
   ✅ "先认可对方情绪→降低防御，再提供替代方案→给对方台阶，最后暗示边界→防止再犯"
   ❌ "这样说可以解决问题"（没说为什么）
4. 潜在风险（真诚提醒）：
   ✅ "注意：如果对方持续越界，需要更直接地表达立场"
   ❌ "没有风险"（敷衍）

【去身份化】
- 去掉所有特定职业（收纳师/老板/总监→通用词）
- 去掉所有人名/IP（纳爷/脱不花等）

注意：只输出 JSON 数组，不要其他内容。应提尽提，但每条都必须满足强制要求。"""


def get_agent2_review_prompt(extraction: Dict) -> str:
    return f"""你是一个 SFT 数据质量审核专家。请严格审核以下数据：

【待审核数据】
- 类型：{extraction.get('content_type', '未知')}
- 来源：{extraction.get('source_video', '未知')}
- 问题：{extraction.get('question', '')[:300]}
- 答案：{extraction.get('answer', '')[:400]}
- 思考：{extraction.get('thinking', '')[:300]}
- 道理：{extraction.get('principle', '')[:200]}

【审核清单（8 条精品标准）】
1. 【语义一致性】答案是否真正回答了问题？（核心标准，不通过直接丢弃）
2. 用户问题真实 → 用户真的会这样问吗？不是教科书问题？不是推广类问题？
3. 话术具体可操作 → 有原话/步骤吗？不是"多沟通"这种空话？
4. 思考过程真实 → 有情绪识别 + 策略分析吗？不是伪思考？（P0 重点）
5. 无特定身份 → 没有"收纳师/老板/总监"等特定职业？
6. 无人名/IP → 没有"纳爷/脱不花"等人名？
7. 话术有温度 → 有 2-3 个语气词（哎呀、呢、哦、嘛、啦、呀、吧等）？
8. 有场景感 → 有场景描述（比如...的时候、找个时机、假设等）？

【语义一致性判断（最重要）】
逐项检查：
- 答案的主题是否与问题一致？
- 答案是否解决了问题的核心诉求？
- 答案中的话术是否适用于问题描述的场景？

示例：
- ✅ 问题"朋友心情不好咋安慰"→答案"你可以这样说：'我知道你现在很难受...'"
- ❌ 问题"朋友遇到困难咋帮"→答案"你可以问他喜欢什么样的男生"（答非所问）

【思考真实性检查（P0 重点）】
逐项检查思考过程，必须同时满足以下 4 点：
1. 情绪识别（具体情绪词 + 触发点 + 内心冲突）：
   ✅ "用户此刻感到委屈（情绪），因为自己的付出没有被看见（触发点），但又怕直接表达会显得小气（内心冲突）"
   ❌ "用户感到困扰"（太模糊，没有具体情绪词）
   ❌ "用户遇到了沟通问题"（伪思考，只是复述问题）
2. 核心诉求（表面问题→真实需求）：
   ✅ "用户表面问'怎么办'，实际想要的是：既不被占便宜，又不破坏关系"
   ❌ "用户需要解决方案"（太笼统）
3. 策略分析（为什么有效）：
   ✅ "先认可对方情绪→降低防御，再提供替代方案→给对方台阶，最后暗示边界→防止再犯"
   ❌ "这样说可以解决问题"（没说为什么）
4. 潜在风险（真诚提醒）：
   ✅ "注意：如果对方持续越界，需要更直接地表达立场"
   ❌ "没有风险"（敷衍）

【评分规则】
- 思考真实性：4 要素缺 1 个→≤3 分，缺 2 个及以上→≤2 分
- 场景感：没有"比如/时机/时候/假设"等场景词→≤3 分
- 话术温度：少于 2 个语气词→≤3 分
- 问题真实性：教科书式问题/推广类问题→≤3 分

【语气词和场景感验证（重点）】
逐项检查答案：
- 语气词：至少 2-3 个（哎呀、呢、哦、嘛、啦、呀、吧、啊、~等）
  - ✅ "哎呀，这事儿确实挺让人头疼的，不过呢，我觉得你可以试试..."
  - ❌ "首先，认识到在亲密关系中，建立真实的链接很重要..."（无语气词）
- 场景感：必须有具体场景描述
  - ✅ "比如你们在办公室遇到的时候，你可以这样说..."
  - ❌ "你可以尝试降低自己的需求，比如选择一些不需要他陪伴的活动..."（场景模糊）

【输出格式】请输出 JSON：
{{
  "passed": true/false,
  "fail_reason": "如果不通过，说明原因（如'答非所问：问题和答案主题不一致'）",
  "scores": {{
    "semantic_match": 1-5,
    "question_quality": 1-5,
    "answer_quality": 1-5,
    "thinking_quality": 1-5,
    "tone_quality": 1-5,
    "scene_quality": 1-5
  }},
  "feedback": "简短评语",
  "suggestion": "修改建议（如果需要修改）"
}}

注意：只输出 JSON，不要其他内容。对质量问题零妥协。"""


def get_agent2_fix_prompt(extraction: Dict, feedback: str) -> str:
    return f"""你是一个 SFT 数据打磨专家。请根据审核反馈修改以下数据：

【待修改数据】
- 问题：{extraction.get('question', '')[:300]}
- 答案：{extraction.get('answer', '')[:400]}
- 思考：{extraction.get('thinking', '')[:300]}
- 道理：{extraction.get('principle', '')[:200]}

【审核反馈】
{feedback}

【修改任务】
1. 如果语义不匹配：根据问题重写答案，或根据答案重写问题
2. 如果问题像教科书：改写为口语化问题
3. 如果答案空洞：补充具体话术或步骤
4. 如果思考伪思考：重写为真实思考（必须包含 4 要素）
5. 如果缺少语气词：添加 2-3 个语气词
6. 如果缺少场景感：添加场景描述

【真思考模板（必须包含 4 要素）】
1. 情绪识别（具体情绪词 + 触发点 + 内心冲突）：
   ✅ "用户此刻感到委屈（情绪），因为自己的付出没有被看见（触发点），但又怕直接表达会显得小气（内心冲突）"
2. 核心诉求（表面问题→真实需求）：
   ✅ "用户表面问'怎么办'，实际想要的是：既不被占便宜，又不破坏关系"
3. 策略分析（为什么有效）：
   ✅ "先认可对方情绪→降低防御，再提供替代方案→给对方台阶，最后暗示边界→防止再犯"
4. 潜在风险（真诚提醒）：
   ✅ "注意：如果对方持续越界，需要更直接地表达立场"

【语气词要求】
必须使用至少 2-3 个语气词：
- 句首：哎呀、其实、嗯、那个
- 句中：嘛、呢、哦、啊、呀、吧、啦
- 句末：~、哦、呢、啊、呀、啦、嘛、哈

示例：
✅ "哎呀，这事儿确实挺让人头疼的，不过呢，我觉得你可以试试..."
✅ "其实吧，你可以找个机会跟 TA 聊聊，比如说~"

【场景感要求】
必须包含具体场景描述：
✅ "比如你们在办公室遇到的时候，你可以这样说..."
✅ "找个合适的时机，比如午休或者下班路上，跟 TA 说..."
✅ "假设你正在跟 TA 通电话，你可以这样说..."

【去身份化】
答案中不能出现特定职业身份：
- "领导" → "对方"或"TA"或"上级"
- "老板" → "对方"或"TA"
- "同事" → "对方"或"TA"
- "客户" → "对方"或"TA"

【输出格式】请输出 JSON：
{{
  "question": "修改后的问题",
  "answer": "修改后的答案",
  "thinking": "修改后的思考（必须包含真思考 4 要素）",
  "principle": "修改后的道理",
  "tone_words_count": 语气词数量（数字）,
  "has_scene": true/false
}}

注意：只输出 JSON，不要其他内容。"""


def get_agent3_final_prompt(data: Dict) -> str:
    return f"""你是一个 SFT 格式化专家。请将审核通过的数据组装为标准 SFT 格式。

【输入数据】
- 问题：{data.get('question', '')}
- 答案：{data.get('answer', '')}
- 思考：{data.get('thinking', '')}
- 道理：{data.get('principle', '')}
- 来源：{data.get('source_video', '未知')}
- 类型：{data.get('content_type', '金句型')}

【任务】
组装为标准 SFT 格式（3 条消息：system + user + assistant）

【清理规则 - 答案净化】
在组装前，必须清理答案中可能混入的元数据：
1. 删除答案末尾的"\n思考：..."段落
2. 删除答案末尾的"\n道理：..."段落
3. 删除答案末尾的"\n来源：..."段落
4. 删除答案末尾的"\n类型：..."段落
5. 删除答案末尾的"\n来源视频：..."段落
6. 删除答案中可能存在的"</think>"标签（只保留思考部分的标签）

示例：
❌ 原始答案："你可以这样说...\n思考：情绪识别：...\n道理：..."
✅ 清理后："你可以这样说..."

【最终检查 - 必须满足】
在组装前，请最后检查一遍：
1. 语气词：答案中是否包含至少 2-3 个语气词？
   - 如果没有，请添加（哎呀、呢、哦、嘛、啦、呀、吧等）
2. 场景感：答案中是否包含具体场景描述？
   - 如果没有，请添加（比如...的时候、找个时机、假设等）
3. 思考过程：是否包含"情绪识别："和"策略分析："标签？
   - 情绪识别是否有具体情绪词（委屈/纠结/尴尬/困惑）？
   - 策略分析是否解释了为什么有效？

【输出格式】请输出 JSON：
{{
  "messages": [
    {{
      "role": "system",
      "content": "你是一个拥有极高情商和心理学背景的沟通专家。你擅长分析用户情绪，提供具体可操作的沟通话术。"
    }},
    {{
      "role": "user",
      "content": "问题内容"
    }},
    {{
      "role": "assistant",
      "content": "<think>情绪识别：... 策略分析：...</think>\\n\\n具体回复内容"
    }}
  ],
  "metadata": {{
    "source_video": "来源视频",
    "source_timestamp": "未知",
    "content_type": "类型",
    "quality_score": 0.95
  }}
}}

注意：
- 只输出 JSON
- messages 数组只包含 3 条消息
- assistant 的 content 必须包含 <think> 和</think>标签
- 思考过程必须有"情绪识别："和"策略分析："标签
- 答案必须有语气词和场景感
- 答案不能包含任何元数据（思考/道理/来源/类型）"""


# ==================== API Client ====================

class AsyncZhipuClient:
    def __init__(self, api_key: str, base_url: str):
        self.api_key = api_key
        self.base_url = base_url
        self.session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def chat(self, model: str, messages: List[Dict],
                   temperature: float = 0.7, max_tokens: int = 4000) -> str:
        if not self.session:
            raise RuntimeError("Client not initialized")

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }

        async with self.session.post(
            f"{self.base_url}/chat/completions",
            json=payload
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise Exception(f"API Error {resp.status}: {error_text}")

            result = await resp.json()
            return result["choices"][0]["message"]["content"]


async def call_with_retry(client: AsyncZhipuClient, model: str, messages: List[Dict],
                          temperature: float = 0.7, max_tokens: int = 4000,
                          max_retries: int = MAX_RETRIES) -> str:
    """调用 API，失败就重试"""
    for attempt in range(max_retries):
        try:
            return await client.chat(model, messages, temperature, max_tokens)
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            print(f"  API 调用失败，{attempt + 1}/{max_retries} 次重试：{e}")
            await asyncio.sleep(RETRY_DELAY * (attempt + 1))
    raise Exception("API 调用失败，已达最大重试次数")


def parse_json_response(response: str) -> Optional[List]:
    """解析 JSON 响应，多层降级策略"""
    try:
        response = response.strip()

        # L1: 移除 markdown 包裹
        if response.startswith('```json'):
            response = response[7:]
        elif response.startswith('```'):
            response = response[3:]
        if response.endswith('```'):
            response = response[:-3]
        response = response.strip()

        # L2: 转义控制字符 - 增强版
        import re
        def escape_control_chars_in_string(s):
            """转义字符串内部的控制字符"""
            # 先处理 \r\n → \n
            s = s.replace('\r\n', '\n')
            # 转义裸换行、回车、制表符（不转义已经转义的）
            # 使用负向后顾 (?<!\\) 确保不转义 \\n
            s = re.sub(r'(?<!\\)\n', r'\\n', s)
            s = re.sub(r'(?<!\\)\r', r'\\r', s)
            s = re.sub(r'(?<!\\)\t', r'\\t', s)
            # 转义裸双引号（不转义已经转义的）
            s = re.sub(r'(?<!\\)"', r'\"', s)
            return s

        # 找到所有双引号包裹的字符串，对内容转义
        def replace_string(match):
            return '"' + escape_control_chars_in_string(match.group(1)) + '"'
        response = re.sub(r'"((?:[^"\\]|\\.)*)"', replace_string, response)

        # L3: 提取 JSON 块 - 区分数组和对象
        if response.startswith('['):
            # 数组：从 [ 到最后一个 ]
            start_idx = 0
            end_idx = response.rfind(']') + 1
        elif response.count('{') > 1:
            # 多个对象：可能是数组，尝试提取第一个完整对象
            # 找到第一个 }, 然后找下一个 { 的位置
            first_close = response.find('}')
            if first_close != -1 and first_close + 1 < len(response) and response[first_close + 1] == '{':
                # 多个对象并列，提取第一个
                brace_count = 1
                i = 1
                while i < len(response) and brace_count > 0:
                    if response[i] == '{':
                        brace_count += 1
                    elif response[i] == '}':
                        brace_count -= 1
                    i += 1
                response = response[:i]
            else:
                # 正常的单个对象
                start_idx = response.find('{')
                end_idx = response.rfind('}') + 1
                response = response[start_idx:end_idx]
        else:
            # 单个对象：从第一个 { 到最后一个 }
            start_idx = response.find('{')
            end_idx = response.rfind('}') + 1
            if start_idx != -1 and end_idx > start_idx:
                response = response[start_idx:end_idx]

        # L4: 修复常见错误（缺失逗号、trailing comma）
        response = re.sub(r'}\s*"', '}, "', response)  # } " -> }, "
        response = re.sub(r']\s*"', '], "', response)  # ] " -> ], "
        response = re.sub(r',\s*}', '}', response)     # ,} -> }
        response = re.sub(r',\s*]', ']', response)     # ,] -> ]

        # L5: 修复键值对之间缺失逗号（针对嵌套 JSON）
        # 匹配："value" "key":  → "value", "key":
        response = re.sub(r'"\s*\n\s*"', '",\n"', response)
        # 匹配：数字/布尔值后直接跟"key"  → 数字，"key":
        response = re.sub(r'([0-9]|true|false|null)\s*\n\s*"', r'\1,\n"', response)
        # 匹配：} 后直接跟\n 和"key": (在对象内部)
        response = re.sub(r'}\s*\n\s*"', '},\n"', response)

        data = json.loads(response)

        # 确保返回数组
        if isinstance(data, dict):
            return [data]
        return data
    except json.JSONDecodeError as e:
        print(f"  JSON 解析失败：{e}")
        return None
    except Exception as e:
        print(f"  JSON 解析失败：{e}")
        return None


def load_classifier_results() -> Dict:
    """加载分类器结果"""
    if os.path.exists(CLASSIFIER_OUTPUT):
        with open(CLASSIFIER_OUTPUT, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'results': []}


def get_classification_for_file(classifier_data: Dict, filepath: str) -> Optional[Dict]:
    """获取某个文件的分类结果"""
    for result in classifier_data.get('results', []):
        if result.get('source_file') == filepath:
            return result
    return None


def clean_answer_metadata(answer: str) -> str:
    """清理答案中混入的元数据（思考/道理/来源/类型）"""
    import re

    cleaned = answer

    # 删除末尾的元数据段落（匹配到行尾）
    patterns_to_remove = [
        r'\n\s*思考\s*[:：].*',
        r'\n\s*道理\s*[:：].*',
        r'\n\s*来源\s*[:：].*',
        r'\n\s*类型\s*[:：].*',
        r'\n\s*来源视频\s*[:：].*',
        r'\n\s*source[_\s]*video\s*[:：].*',
        r'\n\s*</assistant>\s*',
    ]

    for pattern in patterns_to_remove:
        cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE | re.DOTALL)

    # 清理多余空白
    cleaned = re.sub(r'\n\s*\n\s*\n', '\n\n', cleaned)

    return cleaned.strip()


async def agent1_extract(client: AsyncZhipuClient, transcript_data: Dict,
                         video_title: str, content_type: str) -> List[Dict]:
    """Agent 1: 提取 + 思考"""
    segments = transcript_data.get('segments', [])
    full_text = " ".join([seg.get('text', '') for seg in segments[:50]])
    transcript_summary = f"视频标题：{video_title}\n总 segment 数：{len(segments)}\n\n内容摘要：\n{full_text[:4000]}"

    prompt = get_agent1_prompt(transcript_summary, video_title, content_type)

    response = await call_with_retry(
        client, "glm-4-flash",
        [{"role": "user", "content": prompt}],
        temperature=0.7, max_tokens=4000
    )

    data = parse_json_response(response)

    if not data:
        raise Exception("Agent 1 JSON 解析失败")

    # 确保是数组格式
    if isinstance(data, dict):
        data = [data]

    if not isinstance(data, list):
        raise Exception("Agent 1 返回的不是数组或对象")

    # 验证每条数据的必要字段
    for i, item in enumerate(data):
        required = ['question', 'answer', 'content_type']
        missing = [k for k in required if not item.get(k)]
        if missing:
            raise Exception(f"Agent 1 第{i+1}条缺少必要字段：{missing}")

    # 清理答案中可能混入的元数据
    for i, item in enumerate(data):
        if item.get('answer'):
            item['answer'] = clean_answer_metadata(item['answer'])

    return data


async def agent2_review(client: AsyncZhipuClient, extraction: Dict) -> Dict:
    """Agent 2: 审核"""
    prompt = get_agent2_review_prompt(extraction)

    response = await call_with_retry(
        client, "glm-4-flash",
        [{"role": "user", "content": prompt}],
        temperature=0.3, max_tokens=3000
    )

    data = parse_json_response(response)

    if not data:
        raise Exception("Agent 2 JSON 解析失败")

    # Agent 2 返回单个对象，如果是数组取第一个
    if isinstance(data, list):
        data = data[0]

    return data


async def agent2_fix(client: AsyncZhipuClient, extraction: Dict, feedback: str) -> Dict:
    """Agent 2 Fix: 根据审核反馈修改数据"""
    prompt = get_agent2_fix_prompt(extraction, feedback)

    response = await call_with_retry(
        client, "glm-4-flash",
        [{"role": "user", "content": prompt}],
        temperature=0.5, max_tokens=4000
    )

    data = parse_json_response(response)

    if not data:
        raise Exception("Agent 2 Fix JSON 解析失败")

    # Agent 2 Fix 返回单个对象，如果是数组取第一个
    if isinstance(data, list):
        data = data[0]

    return data


async def agent3_final(client: AsyncZhipuClient, data: Dict) -> Dict:
    """Agent 3: 格式化为标准 SFT"""
    prompt = get_agent3_final_prompt(data)

    response = await call_with_retry(
        client, "glm-4-flash",
        [{"role": "user", "content": prompt}],
        temperature=0.5, max_tokens=4000
    )

    result = parse_json_response(response)

    if not result:
        raise Exception("Agent 3 JSON 解析失败")

    # Agent 3 返回单个对象，如果是数组取第一个
    if isinstance(result, list):
        result = result[0]

    return result


def check_tone_words(answer: str) -> int:
    """检测答案中的语气词数量"""
    tone_words = ['哎呀', '哎', '嗯', '其实', '那个', '嘛', '呢', '哦', '啊', '呀', '吧', '啦', '哈', '~', '噢', '哟', '嘿']
    count = sum(answer.count(w) for w in tone_words)
    return count


def check_thinking_tags(assistant_content: str) -> bool:
    """检查是否包含完整的 thinking 标签"""
    return '<think>' in assistant_content and '</think>' in assistant_content


def has_thought_process(assistant_content: str) -> bool:
    """检查思考过程是否包含必要的分析维度"""
    if '<think>' not in assistant_content or '</think>' not in assistant_content:
        return False

    # 提取思考内容
    thinking = assistant_content.split('<think>')[1].split('</think>')[0]

    # 检查必要的分析维度
    required = ['情绪识别', '核心诉求', '策略分析']
    return all(k in thinking for k in required)


async def validate_and_fix_thinking(client: AsyncZhipuClient, assistant_content: str) -> str:
    """验证并修复 thinking 标签"""
    if check_thinking_tags(assistant_content) and has_thought_process(assistant_content):
        return assistant_content

    # 提取答案部分
    if '</think>' in assistant_content:
        answer_part = assistant_content.split('</think>')[1].strip()
    else:
        answer_part = assistant_content

    # 提取问题部分（从上下文推断）
    prompt = f"""请为以下回答生成思考过程：

【回答】
{answer_part[:400]}

【要求】
思考过程必须包含以下 4 要素：
1. 情绪识别：用户此刻感到 XX（情绪），因为 XX（触发点），但又 XX（内心冲突）
2. 核心诉求：用户表面问 XX，实际想要的是 XX
3. 策略分析：先 XX→然后 XX→最后 XX，这样有效是因为 XX
4. 潜在风险：注意如果 XX，需要 XX

【输出格式】
只输出思考过程内容（不要</think>标签），150 字内："""

    try:
        thinking = await client.chat("glm-4-flash", [{"role": "user", "content": prompt}])
        thinking = re.sub(r'</think>|<think>', '', thinking).strip()
        return f"<think>{thinking}</think>\n\n{answer_part}"
    except Exception as e:
        print(f"    ⚠️ 生成思考过程失败：{e}")
        # 保底：添加空标签
        if not check_thinking_tags(assistant_content):
            return f"<think>情绪识别：用户遇到了沟通问题。策略分析：提供具体话术建议。</think>\n\n{answer_part}"
        return assistant_content


async def polish_tone_and_scene(client: AsyncZhipuClient, answer: str) -> str:
    """强制润色语气词和场景感"""
    tone_count = check_tone_words(answer)
    has_scene = check_scene(answer)

    if tone_count >= 2 and has_scene:
        return answer

    fix_parts = []
    if tone_count < 2:
        fix_parts.append(f"添加 2-3 个语气词（哎呀、呢、哦、嘛、啦、呀、吧等）")
    if not has_scene:
        fix_parts.append(f"添加具体场景描述（比如...的时候、找个时机、假设等）")

    prompt = f"""请润色以下答案，{", ".join(fix_parts)}：

原文：{answer[:400]}

要求：
1. 保持原意不变
2. 只添加语气词和场景描述，不要改变核心内容
3. 读起来要自然，像真人说话

输出润色后的答案（只输出答案，不要其他内容）："""

    try:
        response = await client.chat("glm-4-flash", [{"role": "user", "content": prompt}])
        return response.strip()
    except:
        return answer


async def process_file(client: AsyncZhipuClient, filepath: str,
                       classifier_result: Dict) -> List[Dict]:
    """处理单个文件，返回多条 SFT 数据"""
    video_title = os.path.basename(filepath).replace('_transcript.json', '')
    content_type = classifier_result.get('content_type', '未知')

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            transcript_data = json.load(f)
    except Exception as e:
        print(f"  读取文件失败：{e}")
        return []

    print(f"\n处理：{video_title[:60]}... (类型={content_type})")

    # Agent 1: 提取
    print("  [Agent 1] 提取中...")
    try:
        extractions = await agent1_extract(client, transcript_data, video_title, content_type)
        print(f"  ✅ 提取完成：共{len(extractions)}条")
    except Exception as e:
        print(f"  ❌ 提取失败：{e}")
        return []

    final_results = []

    # 处理每条提取的数据
    for i, extraction in enumerate(extractions):
        print(f"\n  [处理第 {i+1}/{len(extractions)} 条]")
        print(f"    类型={extraction.get('content_type')}, 问题={extraction.get('question', '')[:30]}...")

        # Agent 2: 审核
        print("    [Agent 2] 审核中...")
        try:
            review = await agent2_review(client, extraction)
            passed = review.get('passed', False)
            scores = review.get('scores', {})

            semantic_score = scores.get('semantic_match', 0)
            tone_score = scores.get('tone_quality', 0)
            scene_score = scores.get('scene_quality', 0)

            if not passed:
                fail_reason = review.get('fail_reason', '未知原因')
                print(f"    ❌ 审核不通过：{fail_reason}")

                if semantic_score <= 2:
                    print("    语义严重不匹配，丢弃此数据")
                    continue

                feedback = review.get('feedback', '')
                suggestion = review.get('suggestion', '')
                fixed = await agent2_fix(client, extraction, f"{feedback} {suggestion}")

                extraction['question'] = fixed.get('question', extraction['question'])
                extraction['answer'] = fixed.get('answer', extraction['answer'])
                extraction['thinking'] = fixed.get('thinking', extraction['thinking'])
                extraction['principle'] = fixed.get('principle', extraction['principle'])
                print("    ✅ 修复完成")
            else:
                print(f"    ✅ 审核通过：语义={semantic_score}/5")

            # 强制检查思考真实性
            thinking_score = scores.get('thinking_quality', 5)
            if thinking_score <= 3:
                print(f"    ⚠️ 思考真实性={thinking_score}/5，强制重写思考过程...")
                thinking_feedback = "思考过程不完整，请按照 4 要素模板重写"
                fixed = await agent2_fix(client, extraction, thinking_feedback)
                extraction['thinking'] = fixed.get('thinking', extraction['thinking'])
                print("    ✅ 思考过程重写完成")

            # 强制检查语气词和场景感
            if tone_score <= 2 or scene_score <= 2:
                print(f"    ⚠️ 语气词={tone_score}/5, 场景感={scene_score}/5，强制修复...")
                fix_feedback = f"语气词不足（{tone_score}/5）需要添加 2-3 个语气词；场景感不足（{scene_score}/5）需要添加具体场景描述。"
                fixed = await agent2_fix(client, extraction, fix_feedback)
                extraction['answer'] = fixed.get('answer', extraction['answer'])
                extraction['thinking'] = fixed.get('thinking', extraction['thinking'])
                print("    ✅ 强制修复完成")

        except Exception as e:
            print(f"    ❌ 审核失败：{e}")
            continue

        # Agent 3: 格式化
        print("    [Agent 3] 格式化中...")
        try:
            final = await agent3_final(client, extraction)

            # 后处理：强制检查语气词和场景感
            messages = final.get('messages', [])
            if len(messages) >= 3:
                assistant_content = messages[2].get('content', '')

                # 后处理 1：强制检查 thinking 标签
                if not check_thinking_tags(assistant_content):
                    print(f"    ⚠️ 后处理检测：缺少 thinking 标签，强制补充...")
                    if '</think>' in assistant_content:
                        answer_part = assistant_content.split('</think>')[1].strip()
                    else:
                        answer_part = assistant_content
                    assistant_content = await validate_and_fix_thinking(client, answer_part)
                    final['messages'][2]['content'] = assistant_content
                    print(f"    ✅ thinking 标签补充完成")

                # 后处理 2：强制检查语气词和场景感
                if '</think>' in assistant_content:
                    answer_part = assistant_content.split('</think>')[1].strip()
                else:
                    answer_part = assistant_content

                tone_count = check_tone_words(answer_part)
                has_scene = check_scene(answer_part)

                if tone_count < 2 or not has_scene:
                    print(f"    ⚠️ 后处理检测：语气词={tone_count}, 场景感={has_scene}，强制润色...")
                    polished_answer = await polish_tone_and_scene(client, answer_part)
                    if '<think>' in assistant_content and '</think>' in assistant_content:
                        thinking_part = assistant_content.split('</think>')[0] + '</think>'
                        assistant_content = thinking_part + '\n\n' + polished_answer
                    final['messages'][2]['content'] = assistant_content
                    print(f"    ✅ 后处理润色完成")

            print(f"    ✅ 格式化完成")

            # 最终质量验证
            validation = validate_sft_quality(final.get('messages', [{}])[2].get('content', ''))
            if not validation['passed']:
                print(f"    ⚠️ 质量验证未通过：{', '.join(validation['issues'])}")
                # 记录到拒绝文件
                with open(REJECTED_FILE, 'a', encoding='utf-8') as f_reject:
                    reject_record = {
                        "reason": "质量验证未通过",
                        "issues": validation['issues'],
                        "scores": validation['scores'],
                        "data": final,
                        "source_video": video_title
                    }
                    f_reject.write(json.dumps(reject_record, ensure_ascii=False) + '\n')
                print(f"    📝 已记录到拒绝文件")
                continue

            final_results.append(final)
            print(f"    ✅ 质量验证通过（总分={validation['total_score']}/20）")
        except Exception as e:
            print(f"    ❌ 格式化失败：{e}")
            continue

    return final_results


def validate_sft_quality(assistant_content: str) -> Dict:
    """
    验证 SFT 数据质量
    返回：{"passed": bool, "issues": list, "scores": dict}
    """
    issues = []
    scores = {
        'thinking_tags': 0,
        'thought_process': 0,
        'tone_words': 0,
        'scene': 0
    }

    # 1. 检查 thinking 标签
    if check_thinking_tags(assistant_content):
        scores['thinking_tags'] = 5
    else:
        issues.append("缺少 thinking 标签")

    # 2. 检查思考过程质量
    if has_thought_process(assistant_content):
        scores['thought_process'] = 5
    else:
        issues.append("思考过程缺少必要维度（情绪识别/核心诉求/策略分析）")

    # 3. 检查语气词
    if '</think>' in assistant_content:
        answer_part = assistant_content.split('</think>')[1].strip()
    else:
        answer_part = assistant_content

    tone_count = check_tone_words(answer_part)
    scores['tone_words'] = min(5, tone_count)
    if tone_count < 2:
        issues.append(f"语气词不足（{tone_count}个，需要 2-3 个）")

    # 4. 检查场景感
    has_scene = check_scene(answer_part)
    scores['scene'] = 5 if has_scene else 0
    if not has_scene:
        issues.append("缺少场景描述")

    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "scores": scores,
        "total_score": sum(scores.values())
    }


def load_progress() -> Dict:
    progress_file = os.path.join(OUTPUT_DIR, "sft_progress.json")
    if os.path.exists(progress_file):
        with open(progress_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'processed': [], 'failed': []}


def save_progress(processed: List[str], failed: List[str], total_sft: int):
    progress_file = os.path.join(OUTPUT_DIR, "sft_progress.json")
    with open(progress_file, 'w', encoding='utf-8') as f:
        json.dump({
            'processed': processed,
            'failed': failed,
            'total_sft': total_sft,
            'completed_at': datetime.now().isoformat()
        }, f, ensure_ascii=False, indent=2)


def find_batch_files(classifier_data: Dict, count: int = 100) -> List[str]:
    """查找批量处理的文件（A/B/F 型且未处理的）"""
    progress = load_progress()
    processed = set(progress.get('processed', []))

    eligible_files = set()
    filtered_count = 0

    for result in classifier_data.get('results', []):
        content_type = result.get('content_type', '')
        quality_flags = result.get('quality_flags', {})

        # 只处理 A/B/F 型
        if content_type in ['A', 'B', 'F']:
            # 检查质量标记
            if quality_flags.get('semantic_mismatch', False):
                print(f"  ⚠️ 跳过 {result.get('source_file')}：语义不匹配")
                filtered_count += 1
                continue
            eligible_files.add(result.get('source_file', ''))

    if filtered_count > 0:
        print(f"  已过滤 {filtered_count} 个语义不匹配的文件")

    pending = [f for f in eligible_files if f not in processed]
    pending.sort()

    return pending[:count]


async def process_file_with_semaphore(
    client: AsyncZhipuClient,
    filepath: str,
    classifier_result: Dict,
    semaphore: asyncio.Semaphore
) -> List[Dict]:
    """带信号量控制的并发处理"""
    async with semaphore:
        return await process_file(client, filepath, classifier_result)


async def main():
    print("=" * 60)
    print("管道 3：SFT 微调数据提取 V9.0（分流器架构）")
    print("=" * 60)
    print("核心功能：")
    print("1. 复用 V11 的 3-Agent 流水线（提取→审核 + 打磨→格式化）")
    print("2. 只处理 A/B/F 型内容（公式教学型、话术演示型、问答技巧型）")
    print("3. 强制检查思考真实性、语气词、场景感")
    print("=" * 60)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 加载分类器结果
    print("\n加载分类器结果...")
    classifier_data = load_classifier_results()
    if not classifier_data.get('results'):
        print("❌ 分类器结果为空，请先运行 classifier.py")
        return

    print(f"✅ 已加载 {len(classifier_data['results'])} 个分类结果")

    # 统计 A/B/F 型数量
    abf_count = sum(1 for r in classifier_data['results'] if r.get('content_type') in ['A', 'B', 'F'])
    print(f"  A/B/F 型：{abf_count} 个")

    # 查找文件
    files = find_batch_files(classifier_data, 1000)
    print(f"\n找到 {len(files)} 个待处理文件（A/B/F 型且未处理）")

    if not files:
        print("没有待处理文件，退出。")
        return

    # 并发控制
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_FILES)
    total_sft = load_progress().get('total_sft', 0)

    async with AsyncZhipuClient(API_KEY, BASE_URL) as client:
        processed_files = load_progress().get('processed', [])
        failed_files = load_progress().get('failed', [])

        # 批量处理
        batch_size = MAX_CONCURRENT_FILES

        for batch_start in range(0, len(files), batch_size):
            batch_files = files[batch_start:batch_start + batch_size]

            print(f"\n\n{'='*60}")
            print(f"处理批次：{batch_start//batch_size + 1} (本批 {len(batch_files)} 个文件)")
            print(f"{'='*60}")

            # 构建任务
            tasks = []
            for filepath in batch_files:
                classifier_result = get_classification_for_file(classifier_data, filepath)
                if classifier_result:
                    tasks.append(process_file_with_semaphore(
                        client, filepath, classifier_result, semaphore
                    ))

            # 并发执行
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            # 处理结果
            with open(OUTPUT_FILE, 'a', encoding='utf-8') as f_out:
                for i, result in enumerate(batch_results):
                    filepath = batch_files[i]
                    video_title = os.path.basename(filepath)

                    if isinstance(result, Exception):
                        print(f"\n❌ {video_title[:50]}... 处理异常：{result}")
                        failed_files.append(filepath)
                    elif result:
                        for sample in result:
                            f_out.write(json.dumps(sample, ensure_ascii=False) + '\n')
                            total_sft += 1

                        processed_files.append(filepath)
                        print(f"\n✅ {video_title[:50]}... 完成，提取{len(result)}条")

            # 保存进度
            save_progress(processed_files, failed_files, total_sft)

            print(f"\n[当前统计]")
            print(f"  已处理：{len(processed_files)} 个文件")
            print(f"  累计 SFT：{total_sft} 条")
            print(f"  失败：{len(failed_files)} 个")

    # 最终统计
    print("\n" + "=" * 60)
    print("提取完成")
    print("=" * 60)
    print(f"已处理：{len(processed_files)} 个文件")
    print(f"累计 SFT：{total_sft} 条")
    print(f"失败：{len(failed_files)} 个")
    print(f"输出文件：{OUTPUT_FILE}")
    print(f"拒绝记录：{REJECTED_FILE}")
    print("=" * 60)

    # 生成质量报告
    generate_quality_report(processed_files, failed_files, total_sft)


def generate_quality_report(processed: List[str], failed: List[str], total_sft: int):
    """生成质量报告"""
    import os

    # 读取拒绝记录
    rejected_data = []
    if os.path.exists(REJECTED_FILE):
        with open(REJECTED_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        rejected_data.append(json.loads(line))
                    except:
                        pass

    # 统计拒绝原因
    reject_reasons = {}
    for r in rejected_data:
        reason = r.get('reason', '未知')
        issues = r.get('issues', [])
        for issue in issues:
            reject_reasons[issue] = reject_reasons.get(issue, 0) + 1

    # 生成报告
    report_path = os.path.join(OUTPUT_DIR, "sft_quality_report.md")
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write("# SFT 数据质量报告\n\n")
        f.write(f"**生成时间**: {datetime.now().isoformat()}\n\n")
        f.write("## 总体统计\n\n")
        f.write(f"| 指标 | 数量 |\n")
        f.write(f"|------|------|\n")
        f.write(f"| 已处理文件 | {len(processed)} |\n")
        f.write(f"| 累计 SFT 数据 | {total_sft} 条 |\n")
        f.write(f"| 处理失败 | {len(failed)} 个 |\n")
        f.write(f"| 质量拒绝 | {len(rejected_data)} 条 |\n\n")

        f.write("## 拒绝原因分析\n\n")
        if reject_reasons:
            f.write("| 原因 | 数量 |\n")
            f.write("|------|------|\n")
            for reason, count in sorted(reject_reasons.items(), key=lambda x: -x[1]):
                f.write(f"| {reason} | {count} |\n")
        else:
            f.write("无拒绝数据\n")

        f.write("\n## 优化建议\n\n")
        f.write("1. **语义匹配检测**: classifier.py 已增加语义匹配检测，自动过滤不匹配的数据\n")
        f.write("2. **格式检查**: 已增加 thinking 标签验证，确保所有 SFT 数据包含完整的思考过程\n")
        f.write("3. **质量验证**: 已增加最终质量验证，自动拒绝低质量数据\n")

    print(f"\n质量报告已保存到：{report_path}")


if __name__ == "__main__":
    asyncio.run(main())
