-- 源数据审核流程优化
-- 为 raw_data_index 表增加 AI 审核和人工审核相关字段

-- 使用 DO 块进行条件添加
DO $$
BEGIN
    -- 1. AI 审核配置字段
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_review_enabled') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_review_enabled BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_review_prompt') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_review_prompt TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_pass_threshold') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_pass_threshold DECIMAL(5,4) DEFAULT 0.75;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_max_rounds') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_max_rounds INT DEFAULT 2;
    END IF;

    -- 2. AI 审核结果字段
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_review_status') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_review_status VARCHAR(32) DEFAULT 'pending';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_review_score') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_review_score DECIMAL(5,4);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_review_feedback') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_review_feedback TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_review_suggestions') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_review_suggestions JSONB;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_review_rounds') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_review_rounds INT DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'ai_reviewed_at') THEN
        ALTER TABLE raw_data_index ADD COLUMN ai_reviewed_at TIMESTAMP;
    END IF;

    -- 3. 人工审核配置字段
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'manual_review_enabled') THEN
        ALTER TABLE raw_data_index ADD COLUMN manual_review_enabled BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'manual_review_scope') THEN
        ALTER TABLE raw_data_index ADD COLUMN manual_review_scope VARCHAR(32) DEFAULT 'failed';
    END IF;

    -- 4. 人工审核结果字段
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'manual_review_status') THEN
        ALTER TABLE raw_data_index ADD COLUMN manual_review_status VARCHAR(32) DEFAULT 'pending';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'manual_review_decision') THEN
        ALTER TABLE raw_data_index ADD COLUMN manual_review_decision VARCHAR(32);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'manual_review_reason') THEN
        ALTER TABLE raw_data_index ADD COLUMN manual_review_reason TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'manual_reviewer') THEN
        ALTER TABLE raw_data_index ADD COLUMN manual_reviewer VARCHAR(64);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'manual_reviewed_at') THEN
        ALTER TABLE raw_data_index ADD COLUMN manual_reviewed_at TIMESTAMP;
    END IF;

    -- 5. 审核流程控制字段
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'review_flow_status') THEN
        ALTER TABLE raw_data_index ADD COLUMN review_flow_status VARCHAR(32) DEFAULT 'pending';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'raw_data_index' AND column_name = 'review_flow_config') THEN
        ALTER TABLE raw_data_index ADD COLUMN review_flow_config JSONB;
    END IF;
END $$;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_raw_data_ai_review_status ON raw_data_index(ai_review_status);
CREATE INDEX IF NOT EXISTS idx_raw_data_manual_review_status ON raw_data_index(manual_review_status);
CREATE INDEX IF NOT EXISTS idx_raw_data_review_flow_status ON raw_data_index(review_flow_status);

-- 创建源数据审核轮次表（类似于 processed_data 的 review_rounds）
CREATE TABLE IF NOT EXISTS raw_data_review_rounds (
    id BIGSERIAL PRIMARY KEY,
    batch_id VARCHAR(64) NOT NULL,
    data_id VARCHAR(64) NOT NULL,
    round_number INT NOT NULL,
    round_type VARCHAR(32) NOT NULL,  -- ai_review | ai_optimize | manual_review
    ai_score DECIMAL(5,4),
    ai_dimension_scores JSONB,
    ai_feedback TEXT,
    ai_suggestions JSONB,
    ai_passed BOOLEAN,
    optimized BOOLEAN DEFAULT FALSE,
    optimization_result JSONB,
    manual_decision VARCHAR(32),
    manual_reason TEXT,
    manual_reviewer VARCHAR(64),
    manual_reviewed_at TIMESTAMP,
    status VARCHAR(32) DEFAULT 'completed',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_raw_data_review_rounds_batch ON raw_data_review_rounds(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_data_review_rounds_data ON raw_data_review_rounds(data_id);
CREATE INDEX IF NOT EXISTS idx_raw_data_review_rounds_type ON raw_data_review_rounds(round_type);

-- 创建源数据审核反馈日志表
CREATE TABLE IF NOT EXISTS raw_data_review_feedback_logs (
    id BIGSERIAL PRIMARY KEY,
    batch_id VARCHAR(64) NOT NULL,
    data_id VARCHAR(64) NOT NULL,
    suggestion_type VARCHAR(32) NOT NULL,  -- human_optimization / ai_feedback / user_correction
    original_prompt VARCHAR(255),
    user_feedback TEXT,
    optimization_result JSONB,
    applied_to_prompt BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(32)
);

CREATE INDEX IF NOT EXISTS idx_raw_data_feedback_batch ON raw_data_review_feedback_logs(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_data_feedback_type ON raw_data_review_feedback_logs(suggestion_type);

COMMENT ON TABLE raw_data_review_rounds IS '源数据审核轮次记录表';
COMMENT ON TABLE raw_data_review_feedback_logs IS '源数据审核反馈日志表';
