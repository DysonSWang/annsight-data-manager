#!/usr/bin/env python3
"""
管道 2：RAG 知识库提取 V9.0
核心功能：
1. 从转录中提取结构化知识（教训案例、信号解读、隐性规则、操作方法）
2. 输出 Dify 导入格式（id, name, content, tags, metadata）
3. 处理所有非 SKIP 类型的内容
"""

import json
import os
import asyncio
import aiohttp
from typing import Dict, List, Optional
from datetime import datetime
import uuid

# ==================== 配置 ====================

API_KEY = "2ab244591853490484e9543bebe5619c.Xtm8jyApYTG7pYdl"
BASE_URL = "https://open.bigmodel.cn/api/paas/v4"

TRANSCRIPTS_ROOT = "/home/admin/projects/video-wisdom-dataset/transcripts"
OUTPUT_DIR = "/home/admin/projects/eq-trainning/t2"
CLASSIFIER_OUTPUT = os.path.join(OUTPUT_DIR, "classification_result.json")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "rag_knowledge.jsonl")

MAX_CONCURRENT_FILES = 10
MAX_RETRIES = 5
RETRY_DELAY = 2

# ==================== Prompt ====================

RAG_EXTRACTION_PROMPT = """你是一个 RAG 知识库构建专家。请从以下转录中提取结构化知识：

【视频标题】{video_title}
【内容类型】{content_type}
【标签】{tags}

【转录内容】
{transcript}

【提取目标 - 应提尽提】
从转录中提取以下类型的知识（一个视频可能产出多条）：

1. **教训案例** - 错误示范 + 后果
   特征："...会导致..."、"...的后果是..."、"我曾经..."
   示例："当众指出领导错误，我被穿了三年小鞋"

2. **信号解读** - 非语言信号含义
   特征："...=..."、"...意味着..."、"...说明..."
   示例："领导皱眉 + 敲桌子 = 不耐烦"

3. **隐性规则** - 人情世故潜规则
   特征："永远不要..."、"切记..."、"记住..."
   示例："永远不要让别人知道你的底牌"

4. **操作方法** - 具体步骤/技巧
   特征："首先...然后...最后..."、"三步法"、"公式："
   示例："事件 + 错误 + 修改后的反馈 + 道歉"

【输出格式】请输出 JSON 数组（每条是一个独立的知识点）：
[
  {{
    "type": "教训案例/信号解读/隐性规则/操作方法",
    "title": "简短标题（20 字内）",
    "content": "具体内容（200-500 字，独立可读）",
    "tags": ["标签 1", "标签 2"],
    "category": "职场/情感/家庭/社交",
    "target_user": "职场新人/新婚夫妻/...",
    "metadata": {{
      "source_video": "视频标题",
      "has_scene": true/false,
      "has_consequence": true/false,
      "has_alternative": true/false
    }}
  }},
  ...
]

【示例 1：教训案例】
{{
  "type": "教训案例",
  "title": "当众指出领导错误，我被穿了三年小鞋",
  "content": "错误行为：在一次项目会议上，我发现领导汇报的数据有错误，直接站起来说'汪总，这个数据不对'。后果：会议室瞬间安静，领导脸色涨红。从那以后，重要会议不再通知我，我的晋升也被卡了三年。正确做法：私下提醒，给领导留面子。",
  "tags": ["职场沟通", "向上管理", "面子工程"],
  "category": "职场",
  "target_user": "职场新人",
  "metadata": {{
    "source_video": "第 108 集_职场中遇到抢功的同事怎么办",
    "has_scene": true,
    "has_consequence": true,
    "has_alternative": true
  }}
}}

【示例 2：信号解读】
{{
  "type": "信号解读",
  "title": "领导说'我再想想'，通常是否定",
  "content": "当领导说'这个方案我再想想'时，通常不是真的在想，而是委婉的否定。关键信号：1) 语气平淡 2) 眼神回避 3) 没有具体反馈。如果领导真的感兴趣，会追问细节、提出修改意见、约定下次讨论时间。",
  "tags": ["向上管理", "信号解读", "领导沟通"],
  "category": "职场",
  "target_user": "职场新人",
  "metadata": {{
    "source_video": "第 121 集_从此记住，问到你这了，不好也说好",
    "has_scene": false,
    "has_consequence": false,
    "has_alternative": false
  }}
}}

【示例 3：隐性规则】
{{
  "type": "隐性规则",
  "title": "永远不要让别人知道你的底牌",
  "content": "在人际关系中，过早暴露自己的底牌（经济状况、人脉资源、底线）会让你失去主动权。破窗效应：当你暴露自己的弱点，不会引来好人，反而会引来想利用你的人。正确做法：保持神秘感，让别人猜不透你的实力。",
  "tags": ["人际关系", "边界感", "自我保护"],
  "category": "社交",
  "target_user": "所有人",
  "metadata": {{
    "source_video": "第 45 集_脸皮越厚，房子越大",
    "has_scene": false,
    "has_consequence": false,
    "has_alternative": true
  }}
}}

【示例 4：操作方法】
{{
  "type": "操作方法",
  "title": "职场甩锅防身术：事件 + 错误 + 修改后的反馈 + 道歉",
  "content": "公式：事件 + 错误 + 修改后的反馈 + 道歉。操作步骤：1) 找到领导，说明事件（'这个事是我在做'）2) 承认内部沟通错误（'是我们内部没沟通好'）3) 给出修改后的反馈（'刚完善的 80% 进度'）4) 表达道歉和改进计划（'我会继续修改，预计下午三点调整好'）。效果：既澄清事实，又不得罪人。",
  "tags": ["职场沟通", "向上管理", "防甩锅"],
  "category": "职场",
  "target_user": "职场新人",
  "metadata": {{
    "source_video": "第 108 集_职场中遇到抢功的同事怎么办",
    "has_scene": false,
    "has_consequence": false,
    "has_alternative": false
  }}
}}

【提取要求】
1. 内容必须独立可读（不依赖上下文）
2. 保留原文的核心表达
3. 去掉特定身份词和人名/IP
4. 一个视频可能产出多条知识（应提尽提）
5. 每条知识 200-500 字

注意：只输出 JSON 数组，不要其他内容。"""


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
    """解析 JSON 响应 - 多层降级策略"""
    import re
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

        # L2: 转义字符串中的控制字符（\n, \r, \t 在字符串值内）
        def escape_control_chars(match):
            return match.group(0).replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
        response = re.sub(r'"[^"\\]*(?:\\.[^"\\]*)*"', escape_control_chars, response)

        # L3: 提取 JSON 块 - 区分数组和对象
        if response.startswith('['):
            # 数组：从 [ 到最后一个 ]
            start_idx = 0
            end_idx = response.rfind(']') + 1
        else:
            # 对象：从第一个 { 到最后一个 }
            start_idx = response.find('{')
            end_idx = response.rfind('}') + 1

        if start_idx != -1 and end_idx > start_idx:
            response = response[start_idx:end_idx]

        # L4: 修复常见 JSON 错误（缺失逗号、trailing comma）
        response = re.sub(r'}\s*"', '}, "', response)  # } " -> }, "
        response = re.sub(r']\s*"', '], "', response)  # ] " -> ], "
        response = re.sub(r',\s*}', '}', response)     # ,} -> }
        response = re.sub(r',\s*]', ']', response)     # ,] -> ]

        data = json.loads(response)

        # 确保是数组
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


async def extract_rag(client: AsyncZhipuClient, filepath: str,
                      classifier_result: Dict) -> List[Dict]:
    """提取 RAG 知识"""
    video_title = os.path.basename(filepath).replace('_transcript.json', '')

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            transcript_data = json.load(f)
    except Exception as e:
        print(f"  读取文件失败：{e}")
        return []

    # 提取转录内容
    segments = transcript_data.get('segments', [])
    full_text = " ".join([seg.get('text', '') for seg in segments[:50]])
    transcript_summary = f"视频标题：{video_title}\n总 segment 数：{len(segments)}\n\n内容摘要：\n{full_text[:3500]}"

    print(f"\n提取：{video_title[:60]}...")
    print(f"  类型={classifier_result.get('content_type')}, 标签={len(classifier_result.get('tags', []))}个")

    # 调用提取
    prompt = RAG_EXTRACTION_PROMPT.format(
        video_title=video_title,
        content_type=classifier_result.get('content_type', '未知'),
        tags=', '.join(classifier_result.get('tags', [])),
        transcript=transcript_summary
    )

    try:
        response = await call_with_retry(
            client, "glm-4-flash",
            [{"role": "user", "content": prompt}],
            temperature=0.7, max_tokens=4000
        )

        results = parse_json_response(response)

        if not results:
            print(f"  ❌ JSON 解析失败")
            return []

        # 验证格式并添加元数据
        valid_results = []
        for item in results:
            required = ['type', 'title', 'content', 'tags', 'metadata']
            missing = [k for k in required if k not in item]
            if missing:
                print(f"  ⚠️ 跳过一条缺少 {missing} 的数据")
                continue

            # 添加 Dify 格式字段
            item['id'] = f"doc_{uuid.uuid4().hex[:12]}"
            item['name'] = f"[{item['type']}] {item['title']}"
            item['extracted_at'] = datetime.now().isoformat()
            item['source_file'] = filepath

            # 确保 metadata 完整
            if 'metadata' not in item:
                item['metadata'] = {}
            item['metadata']['source'] = video_title
            item['metadata']['authenticity_score'] = 0.95

            valid_results.append(item)

        print(f"  ✅ 提取完成：{len(valid_results)}条")

        return valid_results

    except Exception as e:
        print(f"  ❌ 提取失败：{e}")
        return []


def load_progress() -> Dict:
    progress_file = os.path.join(OUTPUT_DIR, "rag_progress.json")
    if os.path.exists(progress_file):
        with open(progress_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'processed': [], 'failed': []}


def save_progress(processed: List[str], failed: List[str], total_rag: int):
    progress_file = os.path.join(OUTPUT_DIR, "rag_progress.json")
    with open(progress_file, 'w', encoding='utf-8') as f:
        json.dump({
            'processed': processed,
            'failed': failed,
            'total_rag': total_rag,
            'completed_at': datetime.now().isoformat()
        }, f, ensure_ascii=False, indent=2)


def find_batch_files(classifier_data: Dict, count: int = 100) -> List[str]:
    """查找批量处理的文件（非 SKIP 类型且未处理的）"""
    progress = load_progress()
    processed = set(progress.get('processed', []))

    eligible_files = set()
    for result in classifier_data.get('results', []):
        content_type = result.get('content_type', '')
        # 处理所有非 SKIP 类型
        if content_type != 'SKIP':
            eligible_files.add(result.get('source_file', ''))

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
        return await extract_rag(client, filepath, classifier_result)


async def main():
    print("=" * 60)
    print("管道 2：RAG 知识库提取 V9.0")
    print("=" * 60)
    print("核心功能：")
    print("1. 从转录中提取结构化知识（教训案例、信号解读、隐性规则、操作方法）")
    print("2. 输出 Dify 导入格式（id, name, content, tags, metadata）")
    print("3. 处理所有非 SKIP 类型的内容")
    print("=" * 60)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 加载分类器结果
    print("\n加载分类器结果...")
    classifier_data = load_classifier_results()
    if not classifier_data.get('results'):
        print("❌ 分类器结果为空，请先运行 classifier.py")
        return

    print(f"✅ 已加载 {len(classifier_data['results'])} 个分类结果")

    # 统计非 SKIP 类型数量
    non_skip_count = sum(1 for r in classifier_data['results'] if r.get('content_type') != 'SKIP')
    print(f"  非 SKIP 类型：{non_skip_count} 个")

    # 查找文件
    files = find_batch_files(classifier_data, 1000)
    print(f"\n找到 {len(files)} 个待处理文件（非 SKIP 类型且未处理）")

    if not files:
        print("没有待处理文件，退出。")
        return

    # 并发控制
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_FILES)
    total_rag = load_progress().get('total_rag', 0)

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
                            total_rag += 1

                        processed_files.append(filepath)
                        print(f"\n✅ {video_title[:50]}... 完成，提取{len(result)}条")

            # 保存进度
            save_progress(processed_files, failed_files, total_rag)

            print(f"\n[当前统计]")
            print(f"  已处理：{len(processed_files)} 个文件")
            print(f"  累计 RAG：{total_rag} 条")
            print(f"  失败：{len(failed_files)} 个")

    # 最终统计
    print("\n" + "=" * 60)
    print("提取完成")
    print("=" * 60)
    print(f"已处理：{len(processed_files)} 个文件")
    print(f"累计 RAG：{total_rag} 条")
    print(f"失败：{len(failed_files)} 个")
    print(f"输出文件：{OUTPUT_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
