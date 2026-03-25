-- ============================================
-- AnnSight Data Manager - 审核流程优化
-- 版本：v1.3 (2026-03-25)
-- 说明：
--   1. AI 审核配置（支持多轮审核 + 优化）
--   2. 人工审核配置（支持范围配置）
--   3. 反馈日志表（积累修改建议）
-- ============================================

-- ============================================
-- 1. finetuning_tasks 表新增审核配置字段
-- ============================================

-- AI 审核配置
ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS ai_review_enabled BOOLEAN DEFAULT TRUE;
COMMENT ON COLUMN finetuning_tasks.ai_review_enabled IS '是否启用 AI 审核';

ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS ai_review_max_rounds INT DEFAULT 2;
COMMENT ON COLUMN finetuning_tasks.ai_review_max_rounds IS 'AI 审核最大轮次（默认 2）';

ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS ai_review_pass_threshold DECIMAL(5,4) DEFAULT 0.85;
COMMENT ON COLUMN finetuning_tasks.ai_review_pass_threshold IS 'AI 审核通过阈值（默认 0.85）';

ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS ai_auto_optimize_enabled BOOLEAN DEFAULT TRUE;
COMMENT ON COLUMN finetuning_tasks.ai_auto_optimize_enabled IS 'AI 审核失败后是否自动优化';

-- 人工审核配置
ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS manual_review_enabled BOOLEAN DEFAULT TRUE;
COMMENT ON COLUMN finetuning_tasks.manual_review_enabled IS '是否启用人工审核';

ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS manual_review_scope VARCHAR(32) DEFAULT 'failed';
COMMENT ON COLUMN finetuning_tasks.manual_review_scope IS '人工审核范围：all/approved/failed';

ALTER TABLE finetuning_tasks
ADD COLUMN IF NOT EXISTS manual_review_optimization_enabled BOOLEAN DEFAULT TRUE;
COMMENT ON COLUMN finetuning_tasks.manual_review_optimization_enabled IS '人工审核是否支持优化按钮';

-- ============================================
-- 2. review_rounds 表新增字段
-- ============================================

ALTER TABLE review_rounds
ADD COLUMN IF NOT EXISTS manual_optimization_prompt TEXT;
COMMENT ON COLUMN review_rounds.manual_optimization_prompt IS '人工优化提示词';

-- ============================================
-- 3. 创建 review_feedback_logs 表（积累修改建议）
-- ============================================

CREATE TABLE IF NOT EXISTS review_feedback_logs (
    id BIGSERIAL PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL,
    data_id VARCHAR(64) NOT NULL,
    suggestion_type VARCHAR(32) NOT NULL,  -- human_optimization / ai_feedback / user_correction
    original_prompt VARCHAR(255),           -- 原提示词标识
    user_feedback TEXT,                      -- 用户反馈/修改建议
    optimization_result JSONB,               -- { before, after, changes }
    applied_to_prompt BOOLEAN DEFAULT FALSE, -- 是否已应用到提示词
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(32)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_feedback_task ON review_feedback_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON review_feedback_logs(suggestion_type);
CREATE INDEX IF NOT EXISTS idx_feedback_data ON review_feedback_logs(data_id);

-- ============================================
-- 4. review_rounds 表新增索引（优化查询性能）
-- ============================================

CREATE INDEX IF NOT EXISTS idx_review_task_data ON review_rounds(task_id, data_id);
CREATE INDEX IF NOT EXISTS idx_review_round_type ON review_rounds(round_type);

-- ============================================
-- 迁移完成
-- ============================================
