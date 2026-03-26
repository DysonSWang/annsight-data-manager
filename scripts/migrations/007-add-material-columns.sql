-- V9 素材管理扩展
-- 为 processed_data 表添加 V9 相关字段

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'processed_data' AND column_name = 'material_type') THEN
        ALTER TABLE processed_data ADD COLUMN material_type VARCHAR(50);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'processed_data' AND column_name = 'source_video') THEN
        ALTER TABLE processed_data ADD COLUMN source_video VARCHAR(255);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'processed_data' AND column_name = 'source_timestamp') THEN
        ALTER TABLE processed_data ADD COLUMN source_timestamp VARCHAR(50);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'processed_data' AND column_name = 'content_type') THEN
        ALTER TABLE processed_data ADD COLUMN content_type VARCHAR(10);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'processed_data' AND column_name = 'quality_score') THEN
        ALTER TABLE processed_data ADD COLUMN quality_score DECIMAL(3,2);
    END IF;
END $$;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_processed_material_type ON processed_data(material_type);
CREATE INDEX IF NOT EXISTS idx_processed_content_type ON processed_data(content_type);
CREATE INDEX IF NOT EXISTS idx_processed_source_video ON processed_data(source_video);

COMMENT ON COLUMN processed_data.material_type IS '素材类型：sft/rag/dpo/story';
COMMENT ON COLUMN processed_data.content_type IS 'V9 分类：A/B/C/D/E/F/SKIP';
