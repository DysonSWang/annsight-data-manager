#!/usr/bin/env python3
"""
内容分类器 V9.0 - 多标签分类 + 内容类型分流
核心功能：
1. 多标签分类：识别 9 种特征 (has_utterance, has_formula, has_strategy, etc.)
2. 内容类型分类：A(公式教学型)、B(话术演示型)、C(策略建议型)、D(金句道理型)、E(心理学概念型)、F(问答技巧型)、SKIP(非情商内容)
3. 输出：classification_result.json 供后续管道使用
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

MAX_CONCURRENT_FILES = 15
MAX_RETRIES = 5
RETRY_DELAY = 2

# ==================== Classifier Prompt ====================

CLASSIFIER_PROMPT = """你是一个内容分类专家。请分析以下视频转录内容：

【分类任务 - 单选】
判断该内容属于以下哪种类型（单选，选最符合的）：

A. 公式教学型 - 有明确公式/框架 + 完整话术演示
   特征：视频中说"用这个公式：XXX"，然后演示完整对话
   示例："事件 + 错误 + 修改后的反馈 + 道歉"

B. 话术演示型 - 有完整话术示范，但无公式
   特征：专家给出具体怎么说，没有抽象成公式
   示例："你可以这样说：'不行就是不行，后面不用加理由'"

C. 策略建议型 - 有策略/道理，话术分散或缺失
   特征：告诉你要怎么做，但没有具体怎么说
   示例："永远不要让别人知道你的底牌"

D. 金句道理型 - 核心是金句/道理，案例为辅
   特征：有让人印象深刻的金句，用故事证明道理
   示例："脸皮越厚，房子越大"

E. 心理学概念型 - 心理学概念 + 案例 + 方案
   特征：先讲概念（如"破窗效应"），再用案例说明
   示例："情绪否认是关系破裂的开始"

F. 问答技巧型 - 视频开头提出问题 + 技巧 1/2/3
   特征：开头明确问题，然后列出技巧 123
   示例："聊天时不要问'怎么样'——3 个高情商接话技巧"

【多标签特征识别 - 多选】
识别以下内容中包含的特征（多选）：

1. has_utterance（话术）- 有具体的高情商回复原话
   示例："你可以这样说：'不行就是不行，后面不用加理由'"

2. has_implication（暗示）- 话里有话，含蓄表达
   示例："问到你这了，不好也说好"

3. has_strategy（策略）- 有具体操作方法/步骤
   示例："首先...然后...最后..."

4. has_formula（公式）- 有结构化框架
   示例："事件 + 错误 + 修改后的反馈 + 道歉"

5. has_story（故事）- 有完整的故事案例
   示例："我创业第一年认识一个富二代闺蜜..."

6. has_warning（教训）- 有错误示范 + 后果
   示例："当众指出领导错误，我被穿了三年小鞋"

7. has_signal（信号）- 有非语言信号解读
   示例："领导皱眉 + 敲桌子 = 不耐烦"

8. has_theory（理论）- 有心理学/沟通理论
   示例："破窗效应：掏心换来的未必是真心"

9. has_principle（金句）- 有核心金句/道理
   示例："脸皮越厚，房子越大"

【排除规则】
以下情况标记为 SKIP（非情商内容）：
- 纯创业故事/商业思维，且**没有任何**人情世故/情商相关的内容
- 纯销售技巧/业务方法，且**没有任何**沟通话术/人际关系的内容
- 纯穿衣搭配/形象管理，且**没有任何**社交表达/印象管理的内容
- 纯娱乐八卦/人物分析，且**没有任何**可迁移的沟通原理

**注意**：如果视频包含以下任何一种情商元素，则**不应排除**：
- 有具体话术示范
- 有沟通策略/方法
- 有人际关系洞察
- 有信号解读/暗示技巧
- 有教训案例
- 有心理学/沟通理论

【语义匹配检测】
如果内容中包含用户问题和专家回答（如问答型视频），请评估问题 - 答案匹配度：
- **匹配**：答案直接回应了问题，提供了具体的话术/策略/方案
- **部分匹配**：答案与问题相关，但没有直接回应或过于笼统
- **不匹配**：答案与问题无关，或答非所问

检测到"不匹配"时，在 reason 字段注明"语义不匹配"，并在 quality_flags 中添加 "semantic_mismatch": true

【分流规则 - 管道映射】
根据内容类型，决定进入哪些管道：
- A(公式教学型) → 内容素材 + RAG + SFT
- B(话术演示型) → 内容素材 + RAG + SFT
- C(策略建议型) → 内容素材 + RAG + 故事素材
- D(金句道理型) → 内容素材 + RAG + 故事素材
- E(心理学概念型) → 内容素材 + RAG + 故事素材
- F(问答技巧型) → 内容素材 + RAG + SFT
- SKIP → 跳过不处理

【输出格式】请输出 JSON：
{
  "content_type": "A/B/C/D/E/F/SKIP",
  "confidence": 0.0-1.0,
  "reason": "分类理由（50 字内）",
  "tags": ["has_utterance", "has_formula", ...],
  "key_elements": {
    "has_formula": true/false,
    "has_utterance": true/false,
    "has_principle": true/false,
    "has_story": true/false,
    "has_strategy": true/false,
    "has_warning": true/false,
    "has_signal": true/false,
    "has_theory": true/false,
    "has_implication": true/false
  },
  "pipelines": {
    "content_material": true/false,
    "rag_knowledge": true/false,
    "sft_finetuning": true/false,
    "dpo_preference": true/false,
    "story_material": true/false,
    "skip": true/false
  },
  "quality_flags": {
    "semantic_mismatch": true/false,
    "missing_thinking_tags": true/false,
    "metadata_contamination": true/false
  }
}

【转录内容】
{transcript}"""


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
                   temperature: float = 0.3, max_tokens: int = 2000) -> str:
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
                          temperature: float = 0.3, max_tokens: int = 2000,
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


def parse_json_response(response: str) -> Optional[Dict]:
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

        # L2: 提取 JSON 块
        start_idx = response.find('{')
        end_idx = response.rfind('}') + 1
        if start_idx != -1 and end_idx > start_idx:
            response = response[start_idx:end_idx]

        return json.loads(response)
    except json.JSONDecodeError as e:
        print(f"  JSON 解析失败：{e}")
        return None
    except Exception as e:
        print(f"  JSON 解析失败：{e}")
        return None


async def classify_file(client: AsyncZhipuClient, filepath: str) -> Optional[Dict]:
    """处理单个文件，返回分类结果"""
    video_title = os.path.basename(filepath).replace('_transcript.json', '')

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            transcript_data = json.load(f)
    except Exception as e:
        print(f"  读取文件失败：{e}")
        return None

    # 提取转录内容
    segments = transcript_data.get('segments', [])
    full_text = " ".join([seg.get('text', '') for seg in segments[:50]])
    transcript_summary = f"视频标题：{video_title}\n总 segment 数：{len(segments)}\n\n内容摘要：\n{full_text[:3000]}"

    print(f"\n分类：{video_title[:60]}...")

    # 调用 Classifier
    prompt = CLASSIFIER_PROMPT.replace("{transcript}", transcript_summary)

    try:
        response = await call_with_retry(
            client, "glm-4-flash",
            [{"role": "user", "content": prompt}],
            temperature=0.3, max_tokens=2000
        )

        result = parse_json_response(response)

        if not result:
            print(f"  ❌ JSON 解析失败")
            return None

        # 验证必要字段
        required = ['content_type', 'confidence', 'reason', 'tags', 'pipelines']
        missing = [k for k in required if k not in result]
        if missing:
            print(f"  ❌ 缺少必要字段：{missing}")
            return None

        # 初始化 quality_flags（如果 LLM 没有输出）
        if 'quality_flags' not in result:
            result['quality_flags'] = {
                'semantic_mismatch': False,
                'missing_thinking_tags': False,
                'metadata_contamination': False
            }

        # 添加元数据
        result['source_file'] = filepath
        result['video_title'] = video_title
        result['segment_count'] = len(segments)
        result['classified_at'] = datetime.now().isoformat()

        print(f"  ✅ 类型={result['content_type']}, 置信度={result['confidence']}, 标签={len(result['tags'])}个")

        return result

    except Exception as e:
        print(f"  ❌ 分类失败：{e}")
        return None


def load_progress() -> Dict:
    progress_file = os.path.join(OUTPUT_DIR, "classifier_progress.json")
    if os.path.exists(progress_file):
        with open(progress_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'classified': [], 'failed': []}


def save_progress(classified: List[Dict], failed: List[str]):
    progress_file = os.path.join(OUTPUT_DIR, "classifier_progress.json")
    with open(progress_file, 'w', encoding='utf-8') as f:
        json.dump({
            'classified': classified,
            'failed': failed,
            'completed_at': datetime.now().isoformat()
        }, f, ensure_ascii=False, indent=2)


def find_batch_files(count: int = 100) -> List[str]:
    """查找批量处理的文件（前 N 个未处理的）"""
    all_files = []
    for root, dirs, files in os.walk(TRANSCRIPTS_ROOT):
        for f in files:
            if f.endswith('_transcript.json'):
                all_files.append(os.path.join(root, f))
    all_files.sort()

    progress = load_progress()
    processed = set(r['source_file'] for r in progress.get('classified', []))
    pending = [f for f in all_files if f not in processed]

    return pending[:count]


async def process_file_with_semaphore(
    client: AsyncZhipuClient,
    filepath: str,
    semaphore: asyncio.Semaphore
) -> Optional[Dict]:
    """带信号量控制的并发处理"""
    async with semaphore:
        return await classify_file(client, filepath)


def generate_statistics(results: List[Dict]) -> Dict:
    """生成分类统计"""
    stats = {
        'total': len(results),
        'by_type': {},
        'by_tag': {},
        'by_pipeline': {
            'content_material': 0,
            'rag_knowledge': 0,
            'sft_finetuning': 0,
            'dpo_preference': 0,
            'story_material': 0,
            'skip': 0
        },
        'avg_confidence': 0.0
    }

    # 按类型统计
    for r in results:
        ctype = r['content_type']
        stats['by_type'][ctype] = stats['by_type'].get(ctype, 0) + 1

        # 按标签统计
        for tag in r.get('tags', []):
            stats['by_tag'][tag] = stats['by_tag'].get(tag, 0) + 1

        # 按管道统计
        pipelines = r.get('pipelines', {})
        for pipe, enabled in pipelines.items():
            if enabled:
                stats['by_pipeline'][pipe] += 1

    # 平均置信度
    if results:
        stats['avg_confidence'] = sum(r.get('confidence', 0) for r in results) / len(results)

    return stats


async def main():
    print("=" * 60)
    print("内容分类器 V9.0 - 多标签分类 + 内容类型分流")
    print("=" * 60)
    print("核心功能：")
    print("1. 多标签分类：识别 9 种特征")
    print("2. 内容类型分类：A/B/C/D/E/F/SKIP")
    print("3. 管道分流：内容素材、RAG、SFT、DPO、故事素材")
    print("=" * 60)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 查找文件
    files = find_batch_files(1000)
    print(f"\n找到 {len(files)} 个待处理文件")

    if not files:
        print("没有待处理文件，退出。")
        return

    # 并发控制
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_FILES)

    async with AsyncZhipuClient(API_KEY, BASE_URL) as client:
        results = []
        failed_files = []

        # 加载已有进度
        progress = load_progress()
        results = progress.get('classified', [])
        failed_files = progress.get('failed', [])

        # 批量处理
        batch_size = MAX_CONCURRENT_FILES

        for batch_start in range(0, len(files), batch_size):
            batch_files = files[batch_start:batch_start + batch_size]

            print(f"\n\n{'='*60}")
            print(f"处理批次：{batch_start//batch_size + 1} (本批 {len(batch_files)} 个文件)")
            print(f"{'='*60}")

            # 创建并发任务
            tasks = [
                process_file_with_semaphore(client, filepath, semaphore)
                for filepath in batch_files
            ]

            # 并发执行
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            # 处理结果
            for i, result in enumerate(batch_results):
                filepath = batch_files[i]
                video_title = os.path.basename(filepath)

                if isinstance(result, Exception):
                    print(f"\n❌ {video_title[:50]}... 处理异常：{result}")
                    failed_files.append(filepath)
                elif result:
                    results.append(result)
                    print(f"\n✅ {video_title[:50]}... 完成")

            # 保存进度
            save_progress(results, failed_files)

            # 输出当前统计
            stats = generate_statistics(results)
            print(f"\n[当前统计]")
            print(f"  已分类：{stats['total']} 个")
            print(f"  平均置信度：{stats['avg_confidence']:.2f}")
            print(f"  类型分布：{stats['by_type']}")
            print(f"  管道分布：SFT={stats['by_pipeline']['sft_finetuning']}, RAG={stats['by_pipeline']['rag_knowledge']}, 内容={stats['by_pipeline']['content_material']}")

    # 最终统计
    print("\n" + "=" * 60)
    print("分类完成")
    print("=" * 60)

    stats = generate_statistics(results)
    print(f"总分类：{stats['total']} 个")
    print(f"平均置信度：{stats['avg_confidence']:.2f}")
    print(f"类型分布：{stats['by_type']}")
    print(f"标签分布：{stats['by_tag']}")
    print(f"管道分布:")
    print(f"  - 内容素材：{stats['by_pipeline']['content_material']} 个")
    print(f"  - RAG 知识库：{stats['by_pipeline']['rag_knowledge']} 个")
    print(f"  - SFT 微调：{stats['by_pipeline']['sft_finetuning']} 个")
    print(f"  - DPO 偏好：{stats['by_pipeline']['dpo_preference']} 个")
    print(f"  - 故事素材：{stats['by_pipeline']['story_material']} 个")
    print(f"  - 跳过：{stats['by_pipeline']['skip']} 个")
    print(f"失败：{len(failed_files)} 个")
    print(f"输出文件：{CLASSIFIER_OUTPUT}")
    print("=" * 60)

    # 保存最终结果
    output_data = {
        'classified_at': datetime.now().isoformat(),
        'statistics': stats,
        'results': results,
        'failed_files': failed_files
    }

    with open(CLASSIFIER_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print("\n分类结果已保存到 classification_result.json")


if __name__ == "__main__":
    asyncio.run(main())
