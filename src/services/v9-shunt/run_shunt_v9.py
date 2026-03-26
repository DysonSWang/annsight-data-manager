#!/usr/bin/env python3
"""
v9.0 分流器架构 - 主运行脚本
核心功能：
1. 一键运行所有管道（分类器→内容素材→RAG→SFT→DPO→故事素材）
2. 断点续传，支持随时停止和重启
3. 输出完整的统计报告

管道说明：
- 管道 0：classifier.py - 多标签分类 + 内容类型分流
- 管道 1：extract_content_materials.py - 内容素材提取
- 管道 2：extract_rag_knowledge.py - RAG 知识库提取
- 管道 3：extract_sft_v9_shunt.py - SFT 微调数据提取
- 管道 4：extract_dpo_v9.py - DPO 偏好数据提取
- 管道 5：extract_story_material.py - 故事素材提取
"""

import subprocess
import sys
import os
import json
from datetime import datetime
from typing import Dict, List

# ==================== 配置 ====================

OUTPUT_DIR = "/home/admin/projects/eq-trainning/t2"
CLASSIFIER_OUTPUT = os.path.join(OUTPUT_DIR, "classification_result.json")
LOG_DIR = os.path.join(OUTPUT_DIR, "shunt_logs")

# 管道定义
PIPES = [
    {
        "name": "管道 0：内容分类器",
        "script": "classifier.py",
        "description": "多标签分类 + 内容类型分流（A/B/C/D/E/F/SKIP）",
        "output": "classification_result.json",
        "required": True
    },
    {
        "name": "管道 1：内容素材提取",
        "script": "extract_content_materials.py",
        "description": "提取 5 类内容素材（神回复、神暗示、神操作、前车之鉴、理论精讲）",
        "output": "content_materials.jsonl",
        "required": False
    },
    {
        "name": "管道 2：RAG 知识库提取",
        "script": "extract_rag_knowledge.py",
        "description": "提取 RAG 知识库（教训案例、信号解读、隐性规则、操作方法）",
        "output": "rag_knowledge.jsonl",
        "required": False
    },
    {
        "name": "管道 3：SFT 微调数据提取",
        "script": "extract_sft_v9_shunt.py",
        "description": "提取 SFT 微调数据（只处理 A/B/F 型）",
        "output": "sft_data.jsonl",
        "required": False
    },
    {
        "name": "管道 4：DPO 偏好数据提取",
        "script": "extract_dpo_v9.py",
        "description": "提取 DPO 偏好数据（正负样本对）",
        "output": "dpo_data.jsonl",
        "required": False
    },
    {
        "name": "管道 5：故事素材提取",
        "script": "extract_story_material.py",
        "description": "提取故事素材（场景、冲突、解决、结局、道理）",
        "output": "story_materials.jsonl",
        "required": False
    }
]


def print_header(text: str):
    """打印分隔线"""
    print("\n" + "=" * 60)
    print(text)
    print("=" * 60)


def run_pipe(pipe: Dict, dry_run: bool = False) -> bool:
    """运行单个管道"""
    script_path = os.path.join(OUTPUT_DIR, pipe["script"])

    if not os.path.exists(script_path):
        if pipe.get("status") == "pending":
            print(f"⚠️  {pipe['name']}：脚本尚未实现（{pipe['script']}）")
        else:
            print(f"❌ {pipe['name']}：脚本不存在（{pipe['script']}）")
        return False

    if dry_run:
        print(f"✅ {pipe['name']}：已就绪")
        return True

    print(f"\n运行 {pipe['name']}...")
    print(f"  脚本：{pipe['script']}")
    print(f"  输出：{pipe['output']}")

    try:
        result = subprocess.run(
            ["python3", script_path],
            cwd=OUTPUT_DIR,
            capture_output=False,
            text=True
        )

        if result.returncode == 0:
            print(f"✅ {pipe['name']}：运行完成")
            return True
        else:
            print(f"❌ {pipe['name']}：运行失败（返回码 {result.returncode}）")
            return False

    except Exception as e:
        print(f"❌ {pipe['name']}：异常 - {e}")
        return False


def generate_report() -> Dict:
    """生成统计报告"""
    report = {
        "generated_at": datetime.now().isoformat(),
        "pipes": {}
    }

    # 管道 0：分类器统计
    if os.path.exists(CLASSIFIER_OUTPUT):
        with open(CLASSIFIER_OUTPUT, 'r', encoding='utf-8') as f:
            classifier_data = json.load(f)
        report["pipes"]["classifier"] = classifier_data.get("statistics", {})

    # 管道 1：内容素材统计
    content_materials_file = os.path.join(OUTPUT_DIR, "content_materials.jsonl")
    if os.path.exists(content_materials_file):
        count = sum(1 for _ in open(content_materials_file, 'r', encoding='utf-8'))
        report["pipes"]["content_materials"] = {"total": count}

    # 管道 3：SFT 统计
    sft_file = os.path.join(OUTPUT_DIR, "sft_data.jsonl")
    if os.path.exists(sft_file):
        count = sum(1 for _ in open(sft_file, 'r', encoding='utf-8'))
        report["pipes"]["sft"] = {"total": count}

    # 管道 4：DPO 统计
    dpo_file = os.path.join(OUTPUT_DIR, "dpo_data.jsonl")
    if os.path.exists(dpo_file):
        count = sum(1 for _ in open(dpo_file, 'r', encoding='utf-8'))
        report["pipes"]["dpo"] = {"total": count}

    return report


def main():
    import argparse

    parser = argparse.ArgumentParser(description="v9.0 分流器架构 - 主运行脚本")
    parser.add_argument("--all", action="store_true", help="运行所有已实现的管道")
    parser.add_argument("--pipe", type=int, choices=[0, 1, 2, 3, 4, 5], help="运行指定管道")
    parser.add_argument("--dry-run", action="store_true", help="检查所有管道是否就绪")
    parser.add_argument("--report", action="store_true", help="生成统计报告")

    args = parser.parse_args()

    print_header("v9.0 分流器架构 - 主运行脚本")
    print("管道列表：")
    for i, pipe in enumerate(PIPES):
        status = "待实现" if pipe.get("status") == "pending" else "已实现"
        print(f"  [{i}] {pipe['name']} - {pipe['description']} ({status})")

    # Dry run 模式
    if args.dry_run:
        print_header("检查管道就绪状态")
        ready_count = 0
        for pipe in PIPES:
            if pipe.get("status") != "pending" and run_pipe(pipe, dry_run=True):
                ready_count += 1
        print(f"\n就绪管道：{ready_count}/{len(PIPES)}")
        return

    # 生成报告模式
    if args.report:
        print_header("生成统计报告")
        report = generate_report()
        print(json.dumps(report, ensure_ascii=False, indent=2))

        # 保存报告
        report_file = os.path.join(LOG_DIR, f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\n报告已保存：{report_file}")
        return

    # 运行指定管道
    if args.pipe is not None:
        pipe = PIPES[args.pipe]
        success = run_pipe(pipe)
        sys.exit(0 if success else 1)

    # 运行所有管道
    if args.all:
        print_header("运行所有已实现的管道")

        results = {
            "success": [],
            "failed": [],
            "pending": [],
            "skipped": []
        }

        for i, pipe in enumerate(PIPES):
            if pipe.get("status") == "pending":
                results["pending"].append(pipe["name"])
                print(f"\n⚠️  跳过 {pipe['name']}（待实现）")
                continue

            # 检查依赖
            if i > 0 and not os.path.exists(CLASSIFIER_OUTPUT):
                results["skipped"].append(pipe["name"])
                print(f"\n⚠️  跳过 {pipe['name']}（需要先运行管道 0）")
                continue

            success = run_pipe(pipe)
            if success:
                results["success"].append(pipe["name"])
            else:
                results["failed"].append(pipe["name"])

        # 输出结果
        print_header("运行结果")
        print(f"成功：{len(results['success'])} 个")
        print(f"失败：{len(results['failed'])} 个")
        print(f"待实现：{len(results['pending'])} 个")
        print(f"跳过：{len(results['skipped'])} 个")

        if results['success']:
            print("\n成功的管道：")
            for name in results['success']:
                print(f"  ✅ {name}")

        if results['failed']:
            print("\n失败的管道：")
            for name in results['failed']:
                print(f"  ❌ {name}")

        # 生成报告
        report = generate_report()
        report_file = os.path.join(LOG_DIR, f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\n完整报告：{report_file}")

        return

    # 默认显示帮助
    parser.print_help()


if __name__ == "__main__":
    main()
