#!/usr/bin/env python3
"""
管道 5：故事素材提取 V9.0
核心功能：
1. 从转录中提取故事案例（场景、冲突、解决过程、结局、道理）
2. 输出结构化故事素材（可用于短视频脚本/文章素材）
3. 主要处理 C/D/E 型内容（策略建议型、金句道理型、心理学概念型）
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
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "story_materials.jsonl")

MAX_CONCURRENT_FILES = 10
MAX_RETRIES = 5
RETRY_DELAY = 2

# ==================== Prompt ====================

STORY_EXTRACTION_PROMPT = """你是一个故事素材提取专家。请从以下转录中提取故事案例：

【视频标题】{video_title}
【内容类型】{content_type}
【标签】{tags}

【转录内容】
{transcript}

【提取任务 - 应提尽提】
从转录中提取所有完整的故事案例，每个故事包含以下要素：

1. **标题** - 吸引人的故事标题（20 字内）
2. **场景** - 时间/地点/人物关系
3. **冲突** - 核心矛盾/问题
4. **解决过程** - 关键决策点/转折点
5. **结局** - 结果/后果
6. **道理/金句** - 原文中总结的道理

【输出格式】请输出 JSON 数组（每条是一个独立的故事）：
[
  {{
    "title": "吸引人的故事标题（20 字内）",
    "scene": "场景描述（时间/地点/人物关系）",
    "conflict": "核心矛盾/问题",
    "resolution": "解决过程/关键决策",
    "ending": "结局/结果",
    "principle": "道理/金句（原文总结）",
    "tags": ["标签 1", "标签 2"],
    "category": "职场/情感/家庭/社交",
    "word_count": 故事总字数，
    "metadata": {{
      "source_video": "视频标题",
      "story_type": "成功故事/失败教训/转折故事",
      "emotional_arc": "压抑→转折→释然"
    }}
  }},
  ...
]

【示例 1：失败教训】
{{
  "title": "当众指出领导错误，我被穿了三年小鞋",
  "scene": "一次项目会议上，我向领导汪总汇报项目进展。会议室里坐着所有项目组成员。",
  "conflict": "我发现领导汇报的数据有错误，内心纠结：指出错误会让领导难堪，不指出错误会影响项目。",
  "resolution": "我选择了直接指出错误，站起来说'汪总，这个数据不对'。",
  "ending": "会议室瞬间安静，领导脸色涨红。从那以后，重要会议不再通知我，我的晋升也被卡了三年。",
  "principle": "给领导留面子，就是给自己留路子。",
  "tags": ["职场沟通", "向上管理", "面子工程"],
  "category": "职场",
  "word_count": 150,
  "metadata": {{
    "source_video": "教训案例库",
    "story_type": "失败教训",
    "emotional_arc": "自信→尴尬→后悔"
  }}
}}

【示例 2：成功故事】
{{
  "title": "她如何用三句话挽回婚姻",
  "scene": "结婚五年的夫妻，妻子发现丈夫最近总是晚归，两人关系越来越冷淡。",
  "conflict": "妻子想问清楚丈夫是不是有外遇，但又怕问出口后连最后的体面都保不住。",
  "resolution": "妻子没有质问，而是找了个轻松的时机，说：'最近看你很累，是不是工作压力大？我们好久没好好聊天了，周末一起出去走走吧。'",
  "ending": "丈夫愣了一下，眼眶红了。原来他最近在公司遇到大麻烦，怕妻子担心一直不说。那次聊天后，两人关系越来越好。",
  "principle": "好的沟通不是质问，而是给对方开口的机会。",
  "tags": ["婚姻经营", "沟通技巧", "夫妻关系"],
  "category": "情感",
  "word_count": 180,
  "metadata": {{
    "source_video": "第 93 集_23 岁收纳师帮富婆调教调皮儿子",
    "story_type": "成功故事",
    "emotional_arc": "压抑→转折→释然"
  }}
}}

【示例 3：转折故事】
{{
  "title": "脸皮越厚，房子越大",
  "scene": "我创业第一年，认识了一个富二代闺蜜。她家境优越，我出身普通。",
  "conflict": "我把她当真心朋友，掏心掏肺说家里欠债、经济困难。我以为这样能换来真心。",
  "resolution": "没想到，她开始轻视我，觉得我没见过世面。我们的关系也渐渐疏远。",
  "ending": "后来我明白了：掏心换来的未必是真心，可能是别人的把柄。从此我学会了保持神秘感，反而赢得更多尊重。",
  "principle": "脸皮越厚，房子越大。永远不要让别人知道你的底牌。",
  "tags": ["人际关系", "边界感", "自我保护"],
  "category": "社交",
  "word_count": 160,
  "metadata": {{
    "source_video": "第 45 集_脸皮越厚，房子越大",
    "story_type": "转折故事",
    "emotional_arc": "真诚→失望→成长"
  }}
}}

【提取要求】
1. 故事要素完整（场景、冲突、解决、结局、道理）
2. 保留原文的核心表达和金句
3. 去掉特定身份词和人名/IP
4. 一个视频可能产出多个故事（应提尽提）
5. 每个故事 150-300 字

【故事类型定义】
- **失败教训**：主角做错事→导致负面后果→总结教训
- **成功故事**：主角遇到困难→用正确方法→取得好结果
- **转折故事**：主角经历前后对比→领悟道理→成长改变

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


async def extract_stories(client: AsyncZhipuClient, filepath: str,
                          classifier_result: Dict) -> List[Dict]:
    """提取故事素材"""
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
    prompt = STORY_EXTRACTION_PROMPT.format(
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
            required = ['title', 'scene', 'conflict', 'resolution', 'ending', 'principle']
            missing = [k for k in required if k not in item]
            if missing:
                print(f"  ⚠️ 跳过一条缺少 {missing} 的数据")
                continue

            # 添加元数据
            item['extracted_at'] = datetime.now().isoformat()
            item['source_file'] = filepath

            # 确保 metadata 完整
            if 'metadata' not in item:
                item['metadata'] = {}
            item['metadata']['source'] = video_title

            valid_results.append(item)

        print(f"  ✅ 提取完成：{len(valid_results)}条")

        return valid_results

    except Exception as e:
        print(f"  ❌ 提取失败：{e}")
        return []


def load_progress() -> Dict:
    progress_file = os.path.join(OUTPUT_DIR, "story_progress.json")
    if os.path.exists(progress_file):
        with open(progress_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'processed': [], 'failed': []}


def save_progress(processed: List[str], failed: List[str], total_stories: int):
    progress_file = os.path.join(OUTPUT_DIR, "story_progress.json")
    with open(progress_file, 'w', encoding='utf-8') as f:
        json.dump({
            'processed': processed,
            'failed': failed,
            'total_stories': total_stories,
            'completed_at': datetime.now().isoformat()
        }, f, ensure_ascii=False, indent=2)


def find_batch_files(classifier_data: Dict, count: int = 100) -> List[str]:
    """查找批量处理的文件（C/D/E 型且未处理的，优先处理这些类型）"""
    progress = load_progress()
    processed = set(progress.get('processed', []))

    # 优先处理 C/D/E 型（策略建议型、金句道理型、心理学概念型）
    priority_types = ['C', 'D', 'E']
    eligible_files = set()

    for result in classifier_data.get('results', []):
        content_type = result.get('content_type', '')
        # 优先处理 C/D/E 型，但也处理其他非 SKIP 类型
        if content_type in priority_types or (content_type != 'SKIP' and content_type):
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
        return await extract_stories(client, filepath, classifier_result)


async def main():
    print("=" * 60)
    print("管道 5：故事素材提取 V9.0")
    print("=" * 60)
    print("核心功能：")
    print("1. 从转录中提取故事案例（场景、冲突、解决过程、结局、道理）")
    print("2. 输出结构化故事素材（可用于短视频脚本/文章素材）")
    print("3. 优先处理 C/D/E 型内容（策略建议型、金句道理型、心理学概念型）")
    print("=" * 60)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 加载分类器结果
    print("\n加载分类器结果...")
    classifier_data = load_classifier_results()
    if not classifier_data.get('results'):
        print("❌ 分类器结果为空，请先运行 classifier.py")
        return

    print(f"✅ 已加载 {len(classifier_data['results'])} 个分类结果")

    # 统计 C/D/E 型数量
    cde_count = sum(1 for r in classifier_data['results'] if r.get('content_type') in ['C', 'D', 'E'])
    print(f"  C/D/E 型：{cde_count} 个")

    # 查找文件
    files = find_batch_files(classifier_data, 1000)
    print(f"\n找到 {len(files)} 个待处理文件")

    if not files:
        print("没有待处理文件，退出。")
        return

    # 并发控制
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_FILES)
    total_stories = load_progress().get('total_stories', 0)

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
                            total_stories += 1

                        processed_files.append(filepath)
                        print(f"\n✅ {video_title[:50]}... 完成，提取{len(result)}条")

            # 保存进度
            save_progress(processed_files, failed_files, total_stories)

            print(f"\n[当前统计]")
            print(f"  已处理：{len(processed_files)} 个文件")
            print(f"  累计故事：{total_stories} 条")
            print(f"  失败：{len(failed_files)} 个")

    # 最终统计
    print("\n" + "=" * 60)
    print("提取完成")
    print("=" * 60)
    print(f"已处理：{len(processed_files)} 个文件")
    print(f"累计故事：{total_stories} 条")
    print(f"失败：{len(failed_files)} 个")
    print(f"输出文件：{OUTPUT_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
