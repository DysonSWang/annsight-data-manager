/**
 * 处理器注册表
 * 集中管理所有 Pipeline 处理器
 */

const { L1CleanProcessor } = require('./l1-clean');
const { L2StructureProcessor, MockLlmService } = require('./l2-structure');
const { L3EvaluateProcessor } = require('./l3-evaluate');
const { DedupProcessor } = require('./dedup');
const { L25FissionProcessor, MockLlmServiceForFission } = require('./l25-fission');

// 处理器注册表
const PROCESSOR_REGISTRY = {
    'l1-clean': L1CleanProcessor,
    'l2-structure': L2StructureProcessor,
    'l25-fission': L25FissionProcessor,
    'l3-evaluate': L3EvaluateProcessor,
    'dedup': DedupProcessor
};

/**
 * 创建默认处理器实例
 * @param {object} options - 选项
 * @returns {Map<string, BaseProcessor>} 处理器实例映射
 */
function createDefaultProcessors(options = {}) {
    const llmService = options.llmService || new MockLlmService();
    const llmFissionService = options.llmService || new MockLlmServiceForFission();
    const dedupOptions = {
        useFingerprintDb: options.useFingerprintDb || false,
        pool: options.pool,
        threshold: options.dedupThreshold || 0.85,
        numPerm: options.numPerm || 256
    };

    // 裂变配置（从 options 读取）
    const fissionOptions = {
        purposes: options.purposes || ['rag', 'finetuning', 'content_creation']
    };

    return {
        'l1-clean': new L1CleanProcessor(),
        'l25-fission': new L25FissionProcessor(llmFissionService, fissionOptions),
        'l2-structure': new L2StructureProcessor(llmService),
        'l3-evaluate': new L3EvaluateProcessor(),
        'dedup': new DedupProcessor(dedupOptions)
    };
}

/**
 * 注册自定义处理器
 * @param {string} name - 处理器名称
 * @param {class} processorClass - 处理器类
 */
function registerProcessor(name, processorClass) {
    PROCESSOR_REGISTRY[name] = processorClass;
}

/**
 * 获取所有可用的处理器
 * @returns {string[]} 处理器名称列表
 */
function getAvailableProcessors() {
    return Object.keys(PROCESSOR_REGISTRY);
}

module.exports = {
    PROCESSOR_REGISTRY,
    createDefaultProcessors,
    registerProcessor,
    getAvailableProcessors
};
