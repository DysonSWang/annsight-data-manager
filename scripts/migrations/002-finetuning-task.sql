-- ============================================
-- AnnSight Data Manager - 微调任务表结构
-- 版本：v1.1 (2026-03-23)
-- 说明：微调数据审核优化流程支持
-- ============================================

-- ============================================
-- 1. 微调任务配置表
-- ============================================
CREATE TABLE IF NOT EXISTS finetuning_tasks (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,                    -- 任务名称
    purpose TEXT,                                   -- 微调目的说明
    pass_threshold DECIMAL(5,4) DEFAULT 0.90,      -- 合格分值 (0-1)
    max_review_rounds INT DEFAULT 2,                -- 最多 AI 审核次数
    manual_review_enabled BOOLEAN DEFAULT FALSE,    -- 是否启用人工审核
    manual_review_scope VARCHAR(32) DEFAULT 'failed', -- all/failed
    status VARCHAR(32) DEFAULT 'pending',           -- pending/importing/reviewing/optimizing/manual_review/completed/exported
    created_by VARCHAR(32) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    batch_id VARCHAR(32) NOT NULL                   -- 关联的批次 ID
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ft_batch ON finetuning_tasks(batch_id);
CREATE INDEX IF NOT EXISTS idx_ft_status ON finetuning_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ft_created ON finetuning_tasks(created_at DESC);

-- ============================================
-- 2. 审核轮次追踪表
-- ============================================
CREATE TABLE IF NOT EXISTS review_rounds (
    id BIGSERIAL PRIMARY KEY,
    task_id VARCHAR(64) REFERENCES finetuning_tasks(id) ON DELETE CASCADE,
    data_id VARCHAR(64) NOT NULL,                   -- processed_data.id
    round_number INT NOT NULL,                      -- 第几轮审核
    round_type VARCHAR(32) NOT NULL,                -- ai_review/ai_optimize/manual_review

    -- AI 审核结果
    ai_score DECIMAL(5,4),                          -- AI 评分 (0-1)
    ai_dimension_scores JSONB,                      -- 维度评分 {completeness, instruction_following, output_quality, finetuning_suitability}
    ai_feedback TEXT,                               -- AI 总体评价
    ai_suggestions JSONB,                           -- AI 修改建议数组
    ai_passed BOOLEAN,                              -- 是否通过本轮

    -- AI 优化结果
    optimized BOOLEAN DEFAULT FALSE,                -- 是否执行了优化
    optimization_result JSONB,                      -- 优化结果 {title, content, optimization_note}
    optimization_applied BOOLEAN DEFAULT FALSE,     -- 优化是否已应用

    -- 人工审核结果
    manual_reviewed BOOLEAN DEFAULT FALSE,
    manual_decision VARCHAR(32),                    -- approved/rejected/request_optimization
    manual_reason TEXT,
    manual_reviewer VARCHAR(32),
    manual_reviewed_at TIMESTAMP,

    -- 状态
    status VARCHAR(32) DEFAULT 'completed',         -- processing/completed/failed
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_rr_task ON review_rounds(task_id);
CREATE INDEX IF NOT EXISTS idx_rr_data ON review_rounds(data_id);
CREATE INDEX IF NOT EXISTS idx_rr_round ON review_rounds(task_id, data_id, round_number);
CREATE INDEX IF NOT EXISTS idx_rr_type ON review_rounds(round_type);
CREATE INDEX IF NOT EXISTS idx_rr_status ON review_rounds(status);

-- ============================================
-- 3. 审核日志扩展字段
-- ============================================
-- 在现有 review_logs 表基础上，确保支持 finetuning 相关 action

-- 检查是否存在需要添加的 action 类型（可选，用于文档说明）
-- action 字段新增支持的值：
-- - finetuning_task_create: 创建微调任务
-- - finetuning_data_import: 导入数据到任务
-- - ai_review_start: 启动 AI 审核
-- - ai_review_complete: AI 审核完成
-- - ai_optimize_start: 启动 AI 优化
-- - ai_optimize_complete: AI 优化完成
-- - manual_review_start: 启动人工审核
-- - manual_review_complete: 人工审核完成
-- - finetuning_export: 导出微调数据

-- ============================================
-- 4. 视图：任务审核进度
-- ============================================
CREATE OR REPLACE VIEW v_task_progress AS
SELECT
    ft.id AS task_id,
    ft.name AS task_name,
    ft.status AS task_status,
    ft.purpose,
    ft.pass_threshold,
    ft.max_review_rounds,
    ft.manual_review_enabled,
    ft.manual_review_scope,
    COUNT(DISTINCT rr.data_id) AS total_data,
    COUNT(DISTINCT CASE WHEN rr.ai_score >= ft.pass_threshold THEN rr.data_id END) AS passed_data,
    COUNT(DISTINCT CASE WHEN rr.ai_score < ft.pass_threshold AND rr.round_number >= ft.max_review_rounds THEN rr.data_id END) AS failed_data,
    COUNT(DISTINCT CASE WHEN rr.optimized = TRUE THEN rr.data_id END) AS optimized_data,
    COUNT(DISTINCT CASE WHEN rr.manual_reviewed = TRUE THEN rr.data_id END) AS manual_reviewed_data,
    MAX(rr.created_at) AS last_activity
FROM finetuning_tasks ft
LEFT JOIN review_rounds rr ON ft.id = rr.task_id
GROUP BY ft.id, ft.name, ft.status, ft.purpose, ft.pass_threshold, ft.max_review_rounds,
         ft.manual_review_enabled, ft.manual_review_scope;

-- ============================================
-- 5. 视图：单条数据审核详情
-- ============================================
CREATE OR REPLACE VIEW v_data_review_detail AS
SELECT
    rr.task_id,
    rr.data_id,
    rr.round_number,
    rr.round_type,
    rr.ai_score,
    rr.ai_dimension_scores,
    rr.ai_feedback,
    rr.ai_suggestions,
    rr.ai_passed,
    rr.optimized,
    rr.optimization_result,
    rr.optimization_applied,
    rr.manual_reviewed,
    rr.manual_decision,
    rr.manual_reason,
    rr.manual_reviewer,
    rr.manual_reviewed_at,
    rr.status,
    rr.error_message,
    rr.created_at,
    pd.type,
    pd.category,
    pd.title,
    pd.content,
    pd.review_status
FROM review_rounds rr
LEFT JOIN processed_data pd ON rr.data_id = pd.id
ORDER BY rr.task_id, rr.data_id, rr.round_number;

-- ============================================
-- 6. 初始化说明
-- ============================================
-- 无需初始化数据，所有数据通过 API 动态创建
