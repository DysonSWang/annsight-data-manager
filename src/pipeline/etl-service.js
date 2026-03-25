const { PipelineFactory, DEFAULT_PIPELINE_CONFIG } = require('./data-pipeline');
const { createDefaultProcessors } = require('./processors');
const ProcessedDataRepository = require('../repository/ProcessedDataRepository');
const RawDataIndexRepository = require('../repository/RawDataIndexRepository');

// 兼容默认导出
const ProcessedDataRepositoryClass = ProcessedDataRepository.default || ProcessedDataRepository;
const RawDataIndexRepositoryClass = RawDataIndexRepository.default || RawDataIndexRepository;

/**
 * ETL 处理服务
 * 封装 Pipeline 执行逻辑，提供高级接口
 */
class EtlService {
    /**
     * @param {Pool} pool - PostgreSQL 连接池
     * @param {object} options - 选项
     */
    constructor(pool, options = {}) {
        this.pool = pool;
        this.options = options;
        this.repo = new ProcessedDataRepositoryClass(pool);
        this.rawRepo = new RawDataIndexRepositoryClass(pool);
        this.pipelineFactory = new PipelineFactory();

        // 缓存处理器实例，使去重索引跨调用共享
        this._processorsCache = null;
    }

    /**
     * 获取或创建处理器实例
     * @returns {object} 处理器实例
     */
    _getProcessors() {
        if (!this._processorsCache) {
            this._processorsCache = createDefaultProcessors({
                pool: this.pool,
                useFingerprintDb: true
            });
        }
        return this._processorsCache;
    }

    /**
     * 处理单条原始数据
     * @param {string} rawDataId - 原始数据 ID
     * @returns {Promise<object>} 处理结果
     */
    async processRawData(rawDataId) {
        try {
            // 获取原始数据
            const rawData = await this.rawRepo.findById(rawDataId);
            if (!rawData) {
                return {
                    success: false,
                    error: '原始数据不存在',
                    rawDataId
                };
            }

            // 获取转录文本
            let transcript = rawData.transcript_text;
            if (!transcript && rawData.transcript_oss_url) {
                // TODO: 从 OSS 下载转录文本
                transcript = '';
            }

            // 使用缓存的处理器实例
            const processors = this._getProcessors();

            const pipeline = this.pipelineFactory.create('text', processors);

            // 执行 Pipeline（传递 pool 和 rawDataId 用于更新 processing_status）
            const result = await pipeline.execute({
                rawDataId,
                transcript,
                sourceType: rawData.source,
                pool: this.pool
            });

            // 检查是否重复
            if (result.context.isDuplicate) {
                await this.rawRepo.markAsDuplicate(rawDataId, result.context.duplicateOf);
                return {
                    success: false,
                    isDuplicate: true,
                    duplicateOf: result.context.duplicateOf,
                    rawDataId
                };
            }

            // 保存到加工数据表（支持裂变）
            const processedDataIds = await this.saveProcessedData({
                rawDataId,
                ...result.context
            });

            // 裂变数量统计
            const fissionCount = Array.isArray(processedDataIds) ? processedDataIds.length : 1;

            return {
                success: true,
                processedDataIds, // 可能是单条 ID 或数组
                fissionCount,
                pipeline: pipeline.getSummary(result.results),
                context: result.context
            };
        } catch (error) {
            console.error(`ETL 处理失败：${rawDataId}`, error);
            return {
                success: false,
                error: error.message,
                rawDataId
            };
        }
    }

    /**
     * 批量处理数据
     * @param {string[]} rawDataIds - 原始数据 ID 列表
     * @returns {Promise<object>} 处理统计
     */
    async processBatch(rawDataIds) {
        const stats = {
            total: rawDataIds.length,
            success: 0,
            failed: 0,
            duplicate: 0,
            details: []
        };

        for (const rawDataId of rawDataIds) {
            const result = await this.processRawData(rawDataId);
            stats.details.push(result);

            if (result.success) {
                stats.success++;
            } else if (result.isDuplicate) {
                stats.duplicate++;
            } else {
                stats.failed++;
            }
        }

        return stats;
    }

    /**
     * 保存加工数据（支持裂变：1 条源数据 → N 条加工数据）
     * @param {object} context - 上下文数据
     * @returns {Promise<string|string[]>} 加工数据 ID（单条或数组）
     */
    async saveProcessedData(context) {
        const { purposes } = context;

        console.log('[ETL] saveProcessedData called with:', {
            batchId: context.batchId,
            source: context.source,
            itemsCount: context.items?.length
        });

        // 检查是否有裂变数据（items 数组）
        if (context.items && Array.isArray(context.items) && context.items.length > 0) {
            // 裂变模式：保存多条
            const processedDataIds = [];

            for (const item of context.items) {
                console.log('[ETL] saveProcessedData item:', {
                    batchId: item.batchId,
                    hasType: !!item.type,
                    hasTitle: !!item.title
                });

                const id = await this._saveSingleProcessedData({
                    ...context,
                    ...item,
                    // 确保每条数据都有 purposes 字段
                    purposes: item.purposes || purposes || ['rag']
                });
                processedDataIds.push(id);
            }

            return processedDataIds;
        } else {
            // 单条模式：保存一条
            return this._saveSingleProcessedData({
                ...context,
                purposes: purposes || ['rag']
            });
        }
    }

    /**
     * 保存单条加工数据（内部方法）
     */
    async _saveSingleProcessedData(context) {
        const {
            rawDataId,
            type,
            category,
            subcategory,
            targetUser,
            title,
            content,
            tags,
            conversation,
            qualityScore,
            aiConfidenceScore,
            aiModelVersion,
            source,
            batchId
        } = context;

        // 调试日志
        console.log('[ETL] _saveSingleProcessedData:', { batchId, source, title: title?.slice(0, 30) });

        // 计算冷却期（默认 24 小时）
        const coolingHours = 24;
        const coolingUntil = new Date(Date.now() + coolingHours * 60 * 60 * 1000);

        try {
            const processedData = await this.repo.create({
                id: `pd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                rawDataId,
                type,
                category,
                subcategory,
                target_user: targetUser,
                title,
                content,
                tags,
                conversation,
                completeness_score: context.completenessScore,
                authenticity_score: context.authenticityScore,
                quality_score: qualityScore,
                quality_note: context.qualityNote,
                ai_confidence_score: aiConfidenceScore,
                ai_model_version: aiModelVersion,
                cooling_hours: coolingHours,
                cooling_until: coolingUntil,
                source,
                batchId,  // 使用驼峰命名，与 repo.create 的解构匹配
                purposes: context.purposes
            });

            console.log('[ETL] ✅ Saved:', processedData.id, 'batch:', processedData.batch_id);

            // 立即验证数据库中的值
            const verifyResult = await this.pool.query('SELECT batch_id FROM processed_data WHERE id = $1', [processedData.id]);
            const verifyRow = verifyResult.rows[0];
            console.log('[ETL] 🔍 DB verify:', { id: processedData.id, batch_id: verifyRow?.batch_id });

            return processedData.id;
        } catch (error) {
            console.error('[ETL] ❌ Save failed:', error.message);
            throw error;
        }
    }

    /**
     * 处理上传的文本（直接处理，不经过原始数据表）
     * @param {string} text - 文本内容
     * @param {object} metadata - 元数据
     * @param {string[]} metadata.purposes - 用途列表
     * @param {object} metadata.fissionConfig - 裂变配置（每种用途的数量和要求）
     * @param {string} [metadata.rawDataId] - 原始数据 ID（用于更新 processing_status）
     * @returns {Promise<object>} 处理结果
     */
    async processText(text, metadata = {}) {
        try {
            // 使用缓存的处理器实例
            const processors = this._getProcessors();

            // 根据 fissionConfig.enabled 判断是否启用裂变
            const { purposes, fissionConfig, rawDataId } = metadata;

            // 前端传来的 fissionConfig 格式：{ enabled, purposes, config }
            // config 格式：{ rag: { count, requirement }, finetuning: { count, requirement }, ... }
            const useFission = fissionConfig && fissionConfig.enabled === true;

            // 将前端配置转换为后端期望的格式
            const normalizedFissionConfig = useFission && fissionConfig?.config
                ? fissionConfig.config  // 直接使用 config 对象
                : null;

            // 创建 Pipeline 时选择配置
            const pipelineConfig = useFission ? 'fission' : 'text';
            const pipeline = this.pipelineFactory.create(pipelineConfig, processors);

            // 执行 Pipeline（传递 pool 和 rawDataId 用于更新 processing_status）
            const initialContext = {
                rawText: text,
                sourceType: metadata.source || 'upload',
                batchId: metadata.batchId || 'manual',
                purposes: purposes || ['rag'],
                fissionConfig: normalizedFissionConfig,
                rawDataId, // 传递给 Pipeline 用于更新 processing_status
                pool: this.pool
            };
            console.log('[ETL] processText initialContext:', { batchId: initialContext.batchId, source: initialContext.sourceType, rawDataId, useFission });

            const result = await pipeline.execute(initialContext);

            console.log('[ETL] processText result.context:', {
                batchId: result.context?.batchId,
                source: result.context?.source,
                itemsCount: result.context?.items?.length
            });

            // 检查是否重复
            if (result.context.isDuplicate) {
                return {
                    success: false,
                    isDuplicate: true,
                    duplicateOf: result.context.duplicateOf
                };
            }

            // 保存（支持裂变）
            const processedDataIds = await this.saveProcessedData({
                rawDataId: null,
                ...result.context
            });

            // 裂变数量统计
            const fissionCount = Array.isArray(processedDataIds) ? processedDataIds.length : 1;

            return {
                success: true,
                processedDataIds, // 可能是单条 ID 或数组
                fissionCount,
                pipeline: pipeline.getSummary(result.results),
                context: result.context
            };
        } catch (error) {
            console.error('文本处理失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 对已加工的数据执行基于原理的裂变
     * 在微调环节，根据任务目的进行场景裂变
     * @param {object} data - 加工数据对象 { id, type, category, title, content, conversation }
     * @param {object} options - 裂变配置
     * @param {number} options.count - 裂变数量
     * @param {string} options.requirement - 裂变需求说明
     * @param {string} options.purpose - 微调目的
     * @returns {Promise<object>} 裂变结果 { success, count, items, fissionCount }
     */
    async runPrincipleBasedFission(data, options = {}) {
        const { count = 6, requirement = '', purpose = '' } = options;

        console.log('[ETL] runPrincipleBasedFission called:', {
            dataId: data.id,
            count,
            requirement: requirement.slice(0, 50),
            purpose
        });

        try {
            // 使用缓存的处理器实例
            const processors = this._getProcessors();

            // 获取裂变处理器
            const fissionProcessor = processors.find(p => p.getName() === 'l25-fission');
            if (!fissionProcessor) {
                throw new Error('裂变处理器未找到');
            }

            // 准备上下文
            const content = data.content || data.title || '';
            const conversation = data.conversation || null;

            // 构建裂变配置
            const fissionConfig = {
                finetuning: {
                    count,
                    requirement
                }
            };

            // 调用裂变处理器
            const fissionContext = {
                cleanedText: content,
                conversation,
                sourceType: data.type || 'finetuning',
                purposes: ['finetuning'],
                fissionConfig,
                batchId: data.batch_id || `ft-${Date.now()}`,
                source: purpose || 'finetuning-task'
            };

            const fissionResult = await fissionProcessor.process(fissionContext);

            // 保存裂变后的数据
            const savedDataIds = [];
            for (const item of fissionResult.items || []) {
                const id = await this._saveSingleProcessedData({
                    rawDataId: null,
                    source_data_id: data.id,  // 记录来源
                    task_context: { purpose, fromFission: true },
                    fission_config: fissionConfig,
                    ...item,
                    purposes: ['finetuning']
                });
                savedDataIds.push(id);
            }

            console.log('[ETL] runPrincipleBasedFission completed:', {
                fissionCount: savedDataIds.length,
                dataIds: savedDataIds
            });

            return {
                success: true,
                count: savedDataIds.length,
                items: fissionResult.items,
                dataIds: savedDataIds
            };

        } catch (error) {
            console.error('[ETL] runPrincipleBasedFission failed:', error.message);
            return {
                success: false,
                error: error.message,
                data_id: data.id
            };
        }
    }
}

module.exports = { EtlService };
