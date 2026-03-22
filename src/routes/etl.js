const express = require('express');
const { EtlService } = require('../pipeline/etl-service');

const router = express.Router();

/**
 * ETL 处理 API
 */

/**
 * 处理上传的文本
 * POST /api/etl/process-text
 */
async function processText(req, res) {
    try {
        const { text, metadata = {} } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Missing required field: text' });
        }

        const etlService = new EtlService(req.app.locals.pool);
        const result = await etlService.processText(text, metadata);

        res.json(result);
    } catch (error) {
        console.error('Error processing text:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 处理原始数据
 * POST /api/etl/process-raw-data
 */
async function processRawData(req, res) {
    try {
        const { rawDataId } = req.body;

        if (!rawDataId) {
            return res.status(400).json({ error: 'Missing required field: rawDataId' });
        }

        const etlService = new EtlService(req.app.locals.pool);
        const result = await etlService.processRawData(rawDataId);

        res.json(result);
    } catch (error) {
        console.error('Error processing raw data:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * 批量处理
 * POST /api/etl/process-batch
 */
async function processBatch(req, res) {
    try {
        const { rawDataIds } = req.body;

        if (!rawDataIds || !Array.isArray(rawDataIds)) {
            return res.status(400).json({ error: 'Missing or invalid field: rawDataIds' });
        }

        const etlService = new EtlService(req.app.locals.pool);
        const result = await etlService.processBatch(rawDataIds);

        res.json(result);
    } catch (error) {
        console.error('Error processing batch:', error);
        res.status(500).json({ error: error.message });
    }
}

// 注册路由
router.post('/process-text', processText);
router.post('/process-raw-data', processRawData);
router.post('/process-batch', processBatch);

module.exports = router;
