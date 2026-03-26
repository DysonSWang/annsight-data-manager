#!/usr/bin/env python3
"""
管道 1：内容素材提取 V9.0
核心功能：
1. 从转录中提取 5 类内容素材（神回复、神暗示、神操作、前车之鉴、理论精讲）
2. 1-Agent 架构，直接提取 + 格式化
3. 输出：content_materials.jsonl
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
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "content_materials.jsonl")

MAX_CONCURRENT_FILES = 10
MAX_RETRIES = 5
RETRY_DELAY = 2

# ==================== Prompt ====================

CONTENT_MATERIAL_PROMPT = """你是一个内容素材提取专家。请从以下转录中提取 5 类内容素材：

【视频标题】{video_title}

【转录内容】
{transcript}

【内容类型】（来自分类器）
- 分类：{content_type}
- 标签：{tags}

【提取任务 - 应提尽提】
根据视频内容，提取以下 5 类素材（一个视频可能产出多条）：

1. **神回复** - 有具体高情商话术
   特征：视频中有"你可以这样说：..."或给出具体回复原话
   示例："这 500 我收了，其中 200 买监控，300 当定金"

2. **神暗示** - 话里有话/非语言信号解读
   特征：含蓄表达技巧或信号解读
   示例："领导说'我再想想'通常是否定"、"问到你这了，不好也说好"

3. **神操作** - 有策略/公式/操作方法
   特征：有具体操作步骤（1/2/3）或结构化公式
   示例："公式：事件 + 错误 + 修改后的反馈 + 道歉"

4. **前车之鉴** - 有错误示范 + 后果
   特征：有"错误做法→导致后果"的案例
   示例："当众指出领导错误，我被穿了三年小鞋"

5. **理论精讲** - 有心理学/沟通理论
   特征：有理论名称 + 通俗解释 + 应用案例
   示例："破窗效应：掏心换来的未必是真心"

【提取要求】
1. 保留原文话术的核心表达
2. 去掉特定身份词（如"收纳师"→"我"）
3. 去掉人名/IP（如"纳爷"→去掉）
4. 构造吸引人的标题（20 字内）
5. 内容 200-500 字

【输出格式】请输出 JSON 数组：
[
  {{
    "category": "神回复/神暗示/神操作/前车之鉴/理论精讲",
    "title": "吸引人的标题（20 字内）",
    "content": "具体内容（200-500 字）",
    "tags": ["标签 1", "标签 2"],
    "source_video": "视频标题",
    "source_timestamp": "未知",
    "quality_score": 0.95
  }},
  ...
]

【示例 - 神回复】
{{
  "category": "神回复",
  "title": "被人冤枉后，她一句话把危机变商机",
  "content": "这 500 我收了，其中 200 我拿过去买个随身监控，以后有的说；另外 300 就当您下次收纳的定金。背后的道理是：当对方感到愧疚时，提供一个建设性的补偿出口，可以转化关系。",
  "tags": ["高情商回应", "危机处理", "人情往来"],
  "source_video": "第 45 集_脸皮越厚，房子越大",
  "quality_score": 0.95
}}

【示例 - 神操作】
{{
  "category": "神操作",
  "type": "公式",
  "title": "职场甩锅防身术：三步让领导看清真相",
  "content": "公式：事件 + 错误 + 修改后的反馈 + 道歉。操作：1) 找到领导，说明事件 2) 承认内部沟通错误 3) 给出修改后的反馈和道歉。示例：'领导这个事是我在做，是我们内部没沟通好...'",
  "tags": ["职场沟通", "向上管理", "防甩锅"],
  "source_video": "第 108 集_职场中遇到抢功的同事怎么办",
  "quality_score": 0.95
}}

注意：只输出 JSON 数组，不要其他内容。根据视频内容复杂度，提取 1-5 条素材。"""


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
        import re
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


async def extract_materials(client: AsyncZhipuClient, filepath: str,
                           classifier_result: Dict) -> List[Dict]:
    """提取内容素材"""
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
    prompt = CONTENT_MATERIAL_PROMPT.format(
        video_title=video_title,
        transcript=transcript_summary,
        content_type=classifier_result.get('content_type', '未知'),
        tags=', '.join(classifier_result.get('tags', []))
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

        # 添加元数据
        for item in results:
            item['source_file'] = filepath
            item['extracted_at'] = datetime.now().isoformat()

        print(f"  ✅ 提取完成：{len(results)}条")

        return results

    except Exception as e:
        print(f"  ❌ 提取失败：{e}")
        return []


def load_progress() -> Dict:
    progress_file = os.path.join(OUTPUT_DIR, "content_material_progress.json")
    if os.path.exists(progress_file):
        with open(progress_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'processed': [], 'failed': []}


def save_progress(processed: List[str], failed: List[str], total_materials: int):
    progress_file = os.path.join(OUTPUT_DIR, "content_material_progress.json")
    with open(progress_file, 'w', encoding='utf-8') as f:
        json.dump({
            'processed': processed,
            'failed': failed,
            'total_materials': total_materials,
            'completed_at': datetime.now().isoformat()
        }, f, ensure_ascii=False, indent=2)


def find_batch_files(classifier_data: Dict, count: int = 100) -> List[str]:
    """查找批量处理的文件（有分类结果且未处理的）"""
    # 获取已处理的文件
    progress = load_progress()
    processed = set(progress.get('processed', []))

    # 获取有分类结果的文件
    classified_files = set()
    for result in classifier_data.get('results', []):
        source_file = result.get('source_file', '')
        # 跳过 SKIP 类型
        if result.get('content_type') != 'SKIP':
            classified_files.add(source_file)

    # 返回未处理的文件
    pending = [f for f in classified_files if f not in processed]
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
        return await extract_materials(client, filepath, classifier_result)


async def main():
    print("=" * 60)
    print("管道 1：内容素材提取 V9.0")
    print("=" * 60)
    print("核心功能：")
    print("1. 提取 5 类内容素材（神回复、神暗示、神操作、前车之鉴、理论精讲）")
    print("2. 1-Agent 架构，直接提取 + 格式化")
    print("3. 复用分类器结果，只处理非 SKIP 类型")
    print("=" * 60)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 加载分类器结果
    print("\n加载分类器结果...")
    classifier_data = load_classifier_results()
    if not classifier_data.get('results'):
        print("❌ 分类器结果为空，请先运行 classifier.py")
        return

    print(f"✅ 已加载 {len(classifier_data['results'])} 个分类结果")

    # 查找文件
    files = find_batch_files(classifier_data, 1000)
    print(f"\n找到 {len(files)} 个待处理文件（已跳过 SKIP 类型和已处理）")

    if not files:
        print("没有待处理文件，退出。")
        return

    # 并发控制
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_FILES)

    # 统计
    total_materials = load_progress().get('total_materials', 0)

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
                        # 写入文件
                        for material in result:
                            f_out.write(json.dumps(material, ensure_ascii=False) + '\n')
                            total_materials += 1

                        processed_files.append(filepath)
                        print(f"\n✅ {video_title[:50]}... 完成，提取{len(result)}条")

            # 保存进度
            save_progress(processed_files, failed_files, total_materials)

            # 输出当前统计
            print(f"\n[当前统计]")
            print(f"  已处理：{len(processed_files)} 个文件")
            print(f"  累计素材：{total_materials} 条")
            print(f"  失败：{len(failed_files)} 个")

    # 最终统计
    print("\n" + "=" * 60)
    print("提取完成")
    print("=" * 60)
    print(f"已处理：{len(processed_files)} 个文件")
    print(f"累计素材：{total_materials} 条")
    print(f"失败：{len(failed_files)} 个")
    print(f"输出文件：{OUTPUT_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
