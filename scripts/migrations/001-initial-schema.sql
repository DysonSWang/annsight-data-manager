-- ============================================
-- AnnSight Data Manager - 初始数据库表结构
-- 版本：v1.0 (2026-03-20)
-- ============================================

-- ============================================
-- 1. users 表（用户认证）
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(32) PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) DEFAULT 'reviewer',  -- admin/reviewer/viewer
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP
);

-- ============================================
-- 2. 原始数据索引表
-- ============================================
CREATE TABLE IF NOT EXISTS raw_data_index (
    id VARCHAR(64) PRIMARY KEY,
    oss_url TEXT NOT NULL,
    content_type VARCHAR(32) NOT NULL,  -- text/html/mp4/mp3/json
    source VARCHAR(32) NOT NULL,        -- zhihu/xiaohongshu/interview/submission
    batch_id VARCHAR(32) NOT NULL,

    -- 指纹信息（去重用）
    content_md5 VARCHAR(64),
    minhash_hash TEXT,
    video_fingerprint TEXT,
    audio_fingerprint TEXT,

    -- 转录信息
    transcript_status VARCHAR(32) DEFAULT 'pending',
    transcript_oss_url TEXT,
    transcript_text TEXT,

    -- 第一级审核状态
    review_status_raw VARCHAR(32) DEFAULT 'pending',
    reviewed_by_raw VARCHAR(32),
    reviewed_at_raw TIMESTAMP,
    reject_reason_raw TEXT,

    -- 处理状态
    status VARCHAR(32) DEFAULT 'pending',
    duplicate_of VARCHAR(64),
    duplicate_reason TEXT,

    -- 元数据
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_raw_status ON raw_data_index(status);
CREATE INDEX IF NOT EXISTS idx_raw_batch ON raw_data_index(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_md5 ON raw_data_index(content_md5);
CREATE INDEX IF NOT EXISTS idx_raw_source ON raw_data_index(source);
CREATE INDEX IF NOT EXISTS idx_raw_review_status ON raw_data_index(review_status_raw);

-- ============================================
-- 3. 加工数据表
-- ============================================
CREATE TABLE IF NOT EXISTS processed_data (
    id VARCHAR(64) PRIMARY KEY,
    raw_data_id VARCHAR(64) REFERENCES raw_data_index(id) ON DELETE RESTRICT ON UPDATE CASCADE,

    -- 知识库分库标识（用于 Dify 同步路由）
    collection_name VARCHAR(32) DEFAULT 'default',  -- cases/tactics/courses/elder/etc.

    -- 分类体系
    type VARCHAR(32) NOT NULL,
    category VARCHAR(32) NOT NULL,
    subcategory VARCHAR(32),
    target_user VARCHAR(32),

    -- 内容（单条回复/案例）
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    tags JSONB,

    -- 多轮对话样本（用于 SFT 微调）
    conversation JSONB,  -- [{role: 'user', content: '...'}, {role: 'assistant', content: '...'}]

    -- 质量评分
    completeness_score DECIMAL(5,4),   -- 0.0000-1.0000
    authenticity_score INT,            -- 1-5
    quality_score DECIMAL(5,4),        -- 0.0000-1.0000
    quality_note TEXT,

    -- AI 置信度
    ai_confidence_score DECIMAL(5,4),  -- 0.0000-1.0000
    ai_model_version VARCHAR(32),
    auto_approved BOOLEAN DEFAULT FALSE,

    -- 第二级审核状态
    review_status VARCHAR(32) DEFAULT 'pending',
    reviewed_by VARCHAR(32) REFERENCES users(username),
    reviewed_at TIMESTAMP,
    reject_reason TEXT,

    -- 冷却期（可配置）
    cooling_until TIMESTAMP,           -- AI 自动通过的数据需等待至此时间
    cooling_hours INT DEFAULT 24,      -- 冷却期时长（小时），支持差异化配置
    ready_for_rag BOOLEAN DEFAULT FALSE,

    -- 使用标记
    used_in_rag BOOLEAN DEFAULT FALSE,
    used_in_finetuning BOOLEAN DEFAULT FALSE,
    rag_imported_at TIMESTAMP,
    finetuning_exported_at TIMESTAMP,

    -- 来源追溯
    source VARCHAR(32),
    batch_id VARCHAR(32),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_pd_review_status ON processed_data(review_status);
CREATE INDEX IF NOT EXISTS idx_pd_type ON processed_data(type);
CREATE INDEX IF NOT EXISTS idx_pd_category ON processed_data(category);
CREATE INDEX IF NOT EXISTS idx_pd_collection ON processed_data(collection_name);
CREATE INDEX IF NOT EXISTS idx_pd_used_in_rag ON processed_data(used_in_rag);
CREATE INDEX IF NOT EXISTS idx_pd_confidence ON processed_data(ai_confidence_score);
CREATE INDEX IF NOT EXISTS idx_pd_auto_approved ON processed_data(auto_approved);
CREATE INDEX IF NOT EXISTS idx_pd_cooling ON processed_data(cooling_until, ready_for_rag);

-- 复合索引：低置信度查询
CREATE INDEX IF NOT EXISTS idx_review_low_conf ON processed_data(review_status, ai_confidence_score, created_at)
    WHERE review_status = 'pending' AND ai_confidence_score < 0.8;

-- ============================================
-- 4. 审核日志表
-- ============================================
CREATE TABLE IF NOT EXISTS review_logs (
    id BIGSERIAL PRIMARY KEY,
    data_id VARCHAR(64) NOT NULL,
    reviewer_id VARCHAR(32) NOT NULL REFERENCES users(username),
    action VARCHAR(32) NOT NULL,  -- create/update/approve/reject/skip/spot_check_correct
    old_value JSONB,
    new_value JSONB,
    result VARCHAR(32),           -- approved/rejected/skipped/corrected
    ip_address VARCHAR(45),
    is_spot_check BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_logs_data ON review_logs(data_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_reviewer ON review_logs(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_spot_check ON review_logs(is_spot_check);

-- ============================================
-- 5. 指纹库（LSH 持久化）
-- ============================================
CREATE TABLE IF NOT EXISTS fingerprint_index (
    id BIGSERIAL PRIMARY KEY,
    content_md5 VARCHAR(64) UNIQUE,
    minhash_prefix VARCHAR(16),
    minhash_blob BYTEA,           -- 序列化 MinHash 指纹
    data_id VARCHAR(64) NOT NULL REFERENCES processed_data(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fingerprint_md5 ON fingerprint_index(content_md5);
CREATE INDEX IF NOT EXISTS idx_fingerprint_prefix ON fingerprint_index(minhash_prefix);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fingerprint_data ON fingerprint_index(data_id);

-- ============================================
-- 初始化默认管理员用户
-- ============================================
-- 密码：admin123 (bcrypt hash)
INSERT INTO users (id, username, password_hash, role)
VALUES ('admin-001', 'admin', '$2b$10$rMx9YQYxQYxQYxQYxQYxQuRZQxQYxQYxQYxQYxQYxQYxQYxQYxQ', 'admin')
ON CONFLICT (username) DO NOTHING;
