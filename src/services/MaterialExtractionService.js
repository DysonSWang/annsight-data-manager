/**
 * V9 素材提取服务 - 封装 V9 Python 模块调用
 */
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const execAsync = promisify(exec);

class MaterialExtractionService {
    constructor(options = {}) {
        this.v9Dir = options.v9Dir || path.join(__dirname, 'v9-shunt');
        this.outputDir = options.outputDir || path.join(__dirname, '../../temp/v9-output');
        this.apiKey = options.apiKey || process.env.V9_API_KEY;
        this.baseUrl = options.baseUrl || process.env.V9_BASE_URL;

        // 确保输出目录存在
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * 运行 V9 分流器
     * @param {Object} options - 运行选项
     * @param {string} options.transcriptsRoot - 转录文件根目录
     * @param {string[]} options.pipelines - 要运行的管道 ['classifier', 'content', 'rag', 'sft', 'dpo', 'story']
     * @param {boolean} options.dryRun - 仅检查就绪状态
     * @returns {Promise<Object>} 运行结果
     */
    async runShunt(options = {}) {
        const {
            transcriptsRoot,
            pipelines = ['all'],
            dryRun = false
        } = options;

        // 构建命令行参数
        const args = [];
        if (dryRun) {
            args.push('--dry-run');
        }
        if (pipelines.includes('all')) {
            args.push('--all');
        } else {
            pipelines.forEach(pipe => {
                args.push(`--pipe ${pipe}`);
            });
        }

        // 设置环境变量
        const env = {
            ...process.env,
            PYTHONIOENCODING: 'utf-8'
        };

        if (this.apiKey) {
            env.V9_API_KEY = this.apiKey;
        }
        if (this.baseUrl) {
            env.V9_BASE_URL = this.baseUrl;
        }
        if (transcriptsRoot) {
            env.TRANSCRIPTS_ROOT = transcriptsRoot;
        }

        const cmd = `python3 ${path.join(this.v9Dir, 'run_shunt_v9.py')} ${args.join(' ')}`;

        try {
            const { stdout, stderr } = await execAsync(cmd, {
                cwd: this.v9Dir,
                env,
                maxBuffer: 1024 * 1024 * 10 // 10MB buffer
            });

            return {
                success: true,
                stdout,
                stderr,
                outputDir: this.outputDir
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                stdout: error.stdout,
                stderr: error.stderr
            };
        }
    }

    /**
     * 运行单个管道
     * @param {string} pipeline - 管道名称
     * @param {Object} options - 运行选项
     * @returns {Promise<Object>} 运行结果
     */
    async runPipeline(pipeline, options = {}) {
        const { transcriptsRoot } = options;

        const env = {
            ...process.env,
            PYTHONIOENCODING: 'utf-8'
        };

        if (this.apiKey) {
            env.V9_API_KEY = this.apiKey;
        }
        if (transcriptsRoot) {
            env.TRANSCRIPTS_ROOT = transcriptsRoot;
        }

        const pipelineMap = {
            classifier: 'classifier.py',
            content: 'extract_content_materials.py',
            rag: 'extract_rag_knowledge.py',
            sft: 'extract_sft_v9_shunt.py',
            dpo: 'extract_dpo_v9.py',
            story: 'extract_story_material.py'
        };

        const script = pipelineMap[pipeline];
        if (!script) {
            throw new Error(`Unknown pipeline: ${pipeline}`);
        }

        const cmd = `python3 ${path.join(this.v9Dir, script)}`;

        try {
            const { stdout, stderr } = await execAsync(cmd, {
                cwd: this.v9Dir,
                env,
                maxBuffer: 1024 * 1024 * 10
            });

            return {
                success: true,
                stdout,
                stderr,
                outputDir: this.outputDir
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                stdout: error.stdout,
                stderr: error.stderr
            };
        }
    }

    /**
     * 读取管道输出文件
     * @param {string} pipeline - 管道名称
     * @returns {Promise<Array>} 输出数据
     */
    async readPipelineOutput(pipeline) {
        const fileMap = {
            classifier: 'classification_result.json',
            content: 'content_materials.jsonl',
            rag: 'rag_knowledge.jsonl',
            sft: 'sft_data.jsonl',
            dpo: 'dpo_data.jsonl',
            story: 'story_materials.jsonl'
        };

        const fileName = fileMap[pipeline];
        if (!fileName) {
            throw new Error(`Unknown pipeline: ${pipeline}`);
        }

        const filePath = path.join(this.v9Dir, fileName);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Output file not found: ${filePath}`);
        }

        const content = fs.readFileSync(filePath, 'utf-8');

        // JSONL 格式解析
        if (fileName.endsWith('.jsonl')) {
            const lines = content.trim().split('\n').filter(line => line.trim());
            return lines.map(line => JSON.parse(line));
        }

        // JSON 格式解析
        const data = JSON.parse(content);
        return data.results || data;
    }

    /**
     * 检查 V9 模块就绪状态
     * @returns {Promise<Object>} 就绪状态
     */
    async checkReady() {
        const requiredFiles = [
            'classifier.py',
            'extract_sft_v9_shunt.py',
            'extract_rag_knowledge.py',
            'extract_dpo_v9.py',
            'extract_story_material.py',
            'extract_content_materials.py',
            'run_shunt_v9.py'
        ];

        const missing = [];
        const present = [];

        for (const file of requiredFiles) {
            const filePath = path.join(this.v9Dir, file);
            if (fs.existsSync(filePath)) {
                present.push(file);
            } else {
                missing.push(file);
            }
        }

        return {
            ready: missing.length === 0,
            present,
            missing,
            v9Dir: this.v9Dir
        };
    }

    /**
     * 获取统计报告
     * @returns {Promise<Object>} 统计报告
     */
    async getReport() {
        const cmd = `python3 ${path.join(this.v9Dir, 'run_shunt_v9.py')} --report`;

        try {
            const { stdout, stderr } = await execAsync(cmd, {
                cwd: this.v9Dir,
                maxBuffer: 1024 * 1024 * 10
            });

            // 尝试解析 JSON 输出
            const jsonMatch = stdout.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return {
                    success: true,
                    report: JSON.parse(jsonMatch[0]),
                    rawOutput: stdout
                };
            }

            return {
                success: true,
                rawOutput: stdout
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                rawOutput: error.stdout
            };
        }
    }
}

module.exports = MaterialExtractionService;
