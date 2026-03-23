-- 添加 processing_status 字段，用于追踪 ETL 处理阶段
ALTER TABLE raw_data_index ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT NULL;
COMMENT ON COLUMN raw_data_index.processing_status IS 'ETL 处理状态：pending, processing_l1_clean, processing_l25_fission, processing_l2_structure, processing_l3_evaluate, processing_dedup, processed, failed';

-- 创建索引以加速状态查询
CREATE INDEX IF NOT EXISTS idx_raw_data_processing_status ON raw_data_index(processing_status);
