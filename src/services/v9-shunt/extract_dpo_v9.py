#!/usr/bin/env python3
"""
管道 4：DPO 偏好数据提取 V9.0
核心功能：
1. 从转录中提取正负样本对（chosen + rejected）
2. chosen 来自原文高情商话术，rejected 来自视频中的错误示范/低情商回应
3. 输出：dpo_data.jsonl
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
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "dpo_data.jsonl")

MAX_CONCURRENT_FILES = 10
MAX_RETRIES = 5
RETRY_DELAY = 2

# ==================== Prompt ====================

DPO_EXTRACTION_PROMPT = """你是一个 DPO 数据提取专家。请从以下转录中提取正负样本对：

【视频标题】{video_title}
【内容类型】{content_type}
【标签】{tags}

【转录内容】
{transcript}

【提取策略】
从转录中提取正负样本对：
1. **chosen**（正样本）：原文中的高情商话术/正确做法
2. **rejected**（负样本）：
   - 视频中的错误示范（如"当众指出领导错误，我被穿了三年小鞋"）
   - 低情商回应（如"这不是我的问题"）
   - 如果视频没有明确的负样本，可以生成一个"正确的废话"作为对比

【输出格式】请输出 JSON 数组（每条是一个正负样本对）：
[
  {{
    "prompt": {{
      "role": "user",
      "content": "用户问题/场景描述"
    }},
    "chosen": {{
      "role": "assistant",
      "content": "高情商回复原文"
    }},
    "rejected": {{
      "role": "assistant",
      "content": "低情商回复/错误做法"
    }},
    "metadata": {{
      "source_video": "视频标题",
      "type": "话术对比/做法对比",
      "reason": "为什么 chosen 更好（50 字内）"
    }}
  }},
  ...
]

【示例 1：话术对比】
{{
  "prompt": {{
    "role": "user",
    "content": "被人冤枉了，对方事后发红包补偿，该怎么回应？"
  }},
  "chosen": {{
    "role": "assistant",
    "content": "哎呀，这事儿确实挺让人头疼的。这样吧，这钱我收了，一部分拿去做个准备（比如买个监控留个凭证），剩下的就当下次合作的定金。这样大家都不委屈，还能继续合作嘛～"
  }},
  "rejected": {{
    "role": "assistant",
    "content": "你应该拒绝这个红包，因为接受补偿会让你显得软弱。"
  }},
  "metadata": {{
    "source_video": "第 45 集_脸皮越厚，房子越大",
    "type": "话术对比",
    "reason": "chosen 把赔偿转化为合作，既维护尊严又不破坏关系；rejected 是说教式建议，无法解决实际问题"
  }}
}}

【示例 2：做法对比】
{{
  "prompt": {{
    "role": "user",
    "content": "职场中被抢功，该怎么处理？"
  }},
  "chosen": {{
    "role": "assistant",
    "content": "公式：事件 + 错误 + 修改后的反馈 + 道歉。操作：1) 找到领导，说明事件 2) 承认内部沟通错误 3) 给出修改后的反馈和道歉。"
  }},
  "rejected": {{
    "role": "assistant",
    "content": "你应该当面揭穿抢功的同事，让领导知道真相。"
  }},
  "metadata": {{
    "source_video": "第 108 集_职场中遇到抢功的同事怎么办",
    "type": "做法对比",
    "reason": "chosen 用公式化处理，既澄清事实又不得罪人；rejected 会激化矛盾，损害职场关系"
  }}
}}

【提取要求】
1. chosen 必须来自原文，100% 保留原话
2. rejected 可以来自原文（错误示范）或生成（正确的废话）
3. prompt 要是用户真的会问的问题
4. reason 要说清楚为什么 chosen 更好

【注意】
- 一个视频可能产出多条 DPO 数据
- 优先提取视频中的错误示范作为 rejected
- 如果视频没有错误示范，生成"正确的废话"作为 rejected

输出 JSON 数组，不要其他内容。"""


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


async def extract_dpo(client: AsyncZhipuClient, filepath: str,
                      classifier_result: Dict) -> List[Dict]:
    """提取 DPO 数据"""
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
    prompt = DPO_EXTRACTION_PROMPT.format(
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

        # 验证格式
        valid_results = []
        for item in results:
            required = ['prompt', 'chosen', 'rejected', 'metadata']
            missing = [k for k in required if k not in item]
            if missing:
                print(f"  ⚠️ 跳过一条缺少 {missing} 的数据")
                continue

            # 添加元数据
            item['extracted_at'] = datetime.now().isoformat()
            item['source_file'] = filepath

            valid_results.append(item)

        print(f"  ✅ 提取完成：{len(valid_results)}条")

        return valid_results

    except Exception as e:
        print(f"  ❌ 提取失败：{e}")
        return []


def load_progress() -> Dict:
    progress_file = os.path.join(OUTPUT_DIR, "dpo_progress.json")
    if os.path.exists(progress_file):
        with open(progress_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'processed': [], 'failed': []}


def save_progress(processed: List[str], failed: List[str], total_dpo: int):
    progress_file = os.path.join(OUTPUT_DIR, "dpo_progress.json")
    with open(progress_file, 'w', encoding='utf-8') as f:
        json.dump({
            'processed': processed,
            'failed': failed,
            'total_dpo': total_dpo,
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
        return await extract_dpo(client, filepath, classifier_result)


async def main():
    print("=" * 60)
    print("管道 4：DPO 偏好数据提取 V9.0")
    print("=" * 60)
    print("核心功能：")
    print("1. 从转录中提取正负样本对（chosen + rejected）")
    print("2. chosen 来自原文高情商话术，rejected 来自错误示范/低情商回应")
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
    total_dpo = load_progress().get('total_dpo', 0)

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
                            total_dpo += 1

                        processed_files.append(filepath)
                        print(f"\n✅ {video_title[:50]}... 完成，提取{len(result)}条")

            # 保存进度
            save_progress(processed_files, failed_files, total_dpo)

            print(f"\n[当前统计]")
            print(f"  已处理：{len(processed_files)} 个文件")
            print(f"  累计 DPO：{total_dpo} 条")
            print(f"  失败：{len(failed_files)} 个")

    # 最终统计
    print("\n" + "=" * 60)
    print("提取完成")
    print("=" * 60)
    print(f"已处理：{len(processed_files)} 个文件")
    print(f"累计 DPO：{total_dpo} 条")
    print(f"失败：{len(failed_files)} 个")
    print(f"输出文件：{OUTPUT_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
