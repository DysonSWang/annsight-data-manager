/**
 * ETL 处理管道编排器
 * 复用 xiaohongshu-manager 的 Pipeline 架构，适配数据处理场景
 */

// 默认处理流程配置
const DEFAULT_PIPELINE_CONFIG = {
    name: 'default',
    description: '默认数据处理流程',
    steps: [
        { name: 'l1-clean', enabled: true, required: true },
        { name: 'l25-fission', enabled: false, required: false },  // 裂变步骤（可选）
        { name: 'dedup', enabled: true, required: true },          // 去重移到裂变后立即执行
        { name: 'l2-structure', enabled: true, required: true },
        { name: 'l3-evaluate', enabled: true, required: true }
    ]
};

// 不同场景的配置预设
const PIPELINE_PRESETS = {
    // 纯文本处理（不裂变，单条输出）
    text: {
        name: 'text',
        description: '纯文本处理流程',
        steps: [
            { name: 'l1-clean', enabled: true, required: true },
            { name: 'l25-fission', enabled: false, required: false },  // 不启用裂变
            { name: 'dedup', enabled: true, required: true },          // 去重
            { name: 'l2-structure', enabled: true, required: true },
            { name: 'l3-evaluate', enabled: true, required: true }
        ]
    },
    // 裂变模式（启用 L2.5 裂变，L2 结构化为每条裂变数据处理）
    fission: {
        name: 'fission',
        description: '多用途裂变处理流程',
        steps: [
            { name: 'l1-clean', enabled: true, required: true },
            { name: 'l25-fission', enabled: true, required: false },   // 启用裂变
            { name: 'dedup', enabled: true, required: true },          // 去重移到裂变后立即执行
            { name: 'l2-structure', enabled: true, required: true },
            { name: 'l3-evaluate', enabled: true, required: true }
        ]
    },
    // 视频/音频处理（包含转录）
    multimedia: {
        name: 'multimedia',
        description: '视频/音频处理流程',
        steps: [
            { name: 'transcribe', enabled: true, required: true },
            { name: 'l1-clean', enabled: true, required: true },
            { name: 'dedup', enabled: true, required: true },          // 去重
            { name: 'l2-structure', enabled: true, required: true },
            { name: 'l3-evaluate', enabled: true, required: true }
        ]
    },
    // 快速模式（仅清洗和结构化）
    quick: {
        name: 'quick',
        description: '快速处理模式',
        steps: [
            { name: 'l1-clean', enabled: true, required: true },
            { name: 'dedup', enabled: true, required: true },          // 去重
            { name: 'l2-structure', enabled: true, required: false }
        ]
    }
};

/**
 * DataPipeline 类
 */
class DataPipeline {
    /**
     * @param {object} config - Pipeline 配置
     */
    constructor(config = DEFAULT_PIPELINE_CONFIG) {
        this.config = config;
        this.processors = new Map();
        this.context = {};
    }

    /**
     * 注册处理器
     */
    registerProcessor(name, processor) {
        this.processors.set(name, processor);
        return this;
    }

    /**
     * 设置上下文数据
     */
    setContext(key, value) {
        this.context[key] = value;
        return this;
    }

    /**
     * 执行 Pipeline
     * @param {object} initialContext - 初始上下文
     * @returns {Promise<object>} 处理结果
     */
    async execute(initialContext = {}) {
        const context = { ...this.context, ...initialContext };
        const results = {};

        console.log(`[Pipeline] 开始执行流程：${this.config.name}`);
        console.log(`[Pipeline] 步骤数量：${this.config.steps.length}`);

        // 如果有 rawDataId 和 pool，在每个步骤前更新 processing_status
        const updateProcessingStatus = async (stage) => {
            if (context.rawDataId && context.pool) {
                try {
                    const RawDataIndexRepository = require('../repository/RawDataIndexRepository');
                    const repo = new RawDataIndexRepository(context.pool);
                    await repo.updateProcessingStatus(context.rawDataId, stage);
                } catch (err) {
                    console.error(`[Pipeline] 更新 processing_status 失败：${err.message}`);
                }
            }
        };

        for (const stepConfig of this.config.steps) {
            if (!stepConfig.enabled) {
                console.log(`[Pipeline] 跳过步骤：${stepConfig.name}`);
                continue;
            }

            const processor = this.processors.get(stepConfig.name);
            if (!processor) {
                throw new Error(`未找到处理器：${stepConfig.name}`);
            }

            // 更新处理状态
            const processingStage = `processing_${stepConfig.name.replace(/-/g, '_')}`;
            console.log(`[Pipeline] 更新处理状态：${processingStage}`);
            await updateProcessingStatus(processingStage);

            console.log(`[Pipeline] 执行步骤：${stepConfig.name}`);

            try {
                const result = await processor.process(context);
                Object.assign(context, result);
                results[stepConfig.name] = { success: true, data: result };
                console.log(`[Pipeline] 步骤完成：${stepConfig.name}`);
            } catch (error) {
                results[stepConfig.name] = { success: false, error: error.message };

                // 根据配置决定是否继续
                if (stepConfig.required !== false) {
                    throw error;
                }
                console.log(`[Pipeline] 步骤失败（非关键）: ${stepConfig.name}`);
            }
        }

        // 处理完成，更新状态为 processed
        await updateProcessingStatus('processed');

        console.log(`[Pipeline] 流程执行完成：${this.config.name}`);
        return { context, results };
    }

    /**
     * 获取执行结果摘要
     */
    getSummary(results) {
        const summary = {
            pipelineName: this.config.name,
            totalSteps: this.config.steps.length,
            successSteps: 0,
            failedSteps: 0,
            details: []
        };

        for (const [name, result] of Object.entries(results)) {
            if (result.success) {
                summary.successSteps++;
            } else {
                summary.failedSteps++;
            }
            summary.details.push({ name, ...result });
        }

        return summary;
    }
}

/**
 * Pipeline 工厂
 */
class PipelineFactory {
    constructor() {
        this.presets = PIPELINE_PRESETS;
        this.customConfigs = new Map();
    }

    /**
     * 创建 Pipeline
     * @param {string} presetName - 预设名称或自定义配置名称
     * @param {object} processorInstances - 处理器实例映射
     * @returns {DataPipeline}
     */
    create(presetName = 'default', processorInstances = {}) {
        let config = this.presets[presetName];

        if (!config) {
            config = this.customConfigs.get(presetName);
        }

        if (!config) {
            config = DEFAULT_PIPELINE_CONFIG;
        }

        const pipeline = new DataPipeline(config);

        // 注册处理器
        for (const [name, processor] of Object.entries(processorInstances)) {
            pipeline.registerProcessor(name, processor);
        }

        return pipeline;
    }

    /**
     * 注册自定义配置
     */
    registerConfig(name, config) {
        this.customConfigs.set(name, config);
    }

    /**
     * 获取所有可用配置
     */
    getAvailableConfigs() {
        return {
            ...this.presets,
            ...Object.fromEntries(this.customConfigs)
        };
    }
}

module.exports = {
    DataPipeline,
    PipelineFactory,
    DEFAULT_PIPELINE_CONFIG,
    PIPELINE_PRESETS
};
