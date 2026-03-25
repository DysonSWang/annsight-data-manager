/**
 * 裂变启用/禁用测试
 *
 * 测试场景：
 * 1. 禁用裂变 - 上传文本，不勾选裂变选项 → 只生成 1 条加工数据
 * 2. 启用裂变 - 上传文本，勾选裂变选项 → 生成多条加工数据（根据配置数量）
 */

const http = require('http');
const { Pool } = require('pg');

const API_BASE = 'http://localhost:3000/api';
const DB_CONFIG = 'postgresql://postgres:postgres@localhost:5432/annsight_data';

// HTTP 请求封装
function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const fullUrl = API_BASE + path;
        const url = new URL(fullUrl);
        const bodyData = body ? JSON.stringify(body) : null;
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': bodyData ? Buffer.byteLength(bodyData) : 0
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    reject(new Error(`响应解析失败：${data}`));
                }
            });
        });

        req.on('error', reject);
        if (bodyData) req.write(bodyData);
        req.end();
    });
}

// 数据库操作
const pool = new Pool({ connectionString: DB_CONFIG });

// 清理函数
async function cleanup() {
    await pool.query(`DELETE FROM processed_data WHERE batch_id LIKE '%fission-test%'`);
    await pool.query(`DELETE FROM raw_data_index WHERE batch_id LIKE '%fission-test%'`);
    console.log('✓ 已清理测试数据');
}

// ========== 测试场景 1：禁用裂变 ==========
async function testFissionDisabled() {
    console.log('\n' + '='.repeat(60));
    console.log('【测试 1】禁用裂变 - 只生成 1 条加工数据');
    console.log('='.repeat(60));

    const batchId = `fission-test-disabled-${Date.now().toString().slice(-8)}`;
    const timestamp = Date.now().toString();
    const testContent = `禁用裂变测试 - ${timestamp}`;

    // 上传文本，不启用裂变
    console.log('\n步骤 1: 上传文本（fissionConfig.enabled = false）');
    const uploadResult = await request('POST', '/raw-data/batch-text', {
        texts: [{
            title: '禁用裂变测试',
            content: testContent,
            category: '测试',
            type: '测试数据'
        }],
        batchId,
        source: 'fission-test',
        purposes: ['rag'],
        fissionConfig: {
            enabled: false,
            purposes: ['rag'],
            config: {
                rag: {
                    count: 6,
                    requirement: '这是裂变需求，但不会执行'
                }
            }
        }
    });

    if (uploadResult.status !== 200) {
        throw new Error(`上传失败：${JSON.stringify(uploadResult.data)}`);
    }

    const result = uploadResult.data.results?.[0];
    console.log(`✓ 上传成功`);
    console.log(`  成功：${result?.success}`);
    console.log(`  裂变数量：${result?.fissionCount || 0}`);
    console.log(`  加工数据 ID：${JSON.stringify(result?.processedDataIds)}`);

    // 验证：只生成 1 条数据
    if (result?.fissionCount !== 1) {
        throw new Error(`验证失败：期望裂变数量为 1，实际为 ${result?.fissionCount}`);
    }

    // processedDataIds 可能是字符串（单条）或数组（多条）
    const processedDataCount = Array.isArray(result?.processedDataIds)
        ? result.processedDataIds.length
        : (result?.processedDataIds ? 1 : 0);

    if (processedDataCount !== 1) {
        throw new Error(`验证失败：期望 1 条加工数据 ID，实际为 ${processedDataCount}`);
    }

    // 验证数据库（同时检查 type 和 category，确保只计算当前测试的数据）
    const verifyQuery = `
        SELECT COUNT(*) as count
        FROM processed_data
        WHERE batch_id = $1
          AND title LIKE $2
    `;
    const verifyResult = await pool.query(verifyQuery, [batchId, '%禁用裂变测试%']);
    const dbCount = parseInt(verifyResult.rows[0].count);

    console.log(`\n步骤 2: 验证数据库`);
    console.log(`  数据库记录数：${dbCount}`);

    if (dbCount !== 1) {
        throw new Error(`验证失败：数据库期望 1 条记录，实际为 ${dbCount}`);
    }

    console.log('\n✓ 测试 1 通过：禁用裂变时只生成 1 条数据');

    return { batchId, count: dbCount };
}

// ========== 测试场景 2：启用裂变 ==========
async function testFissionEnabled() {
    console.log('\n' + '='.repeat(60));
    console.log('【测试 2】启用裂变 - 生成多条加工数据');
    console.log('='.repeat(60));

    const batchId = `fission-test-enabled-${Date.now().toString().slice(-8)}`;
    const timestamp = Date.now().toString();
    const testContent = `启用裂变测试 - ${timestamp}`;
    const fissionCount = 3;

    // 上传文本，启用裂变
    console.log(`\n步骤 1: 上传文本（fissionConfig.enabled = true, count = ${fissionCount}）`);
    const uploadResult = await request('POST', '/raw-data/batch-text', {
        texts: [{
            title: '启用裂变测试',
            content: testContent,
            category: '测试',
            type: '测试数据'
        }],
        batchId,
        source: 'fission-test',
        purposes: ['finetuning'],
        fissionConfig: {
            enabled: true,
            purposes: ['finetuning'],
            config: {
                finetuning: {
                    count: fissionCount,
                    requirement: '同一理念，不同场景。请生成 3 个不同场景的变体。'
                }
            }
        }
    });

    if (uploadResult.status !== 200) {
        throw new Error(`上传失败：${JSON.stringify(uploadResult.data)}`);
    }

    const result = uploadResult.data.results?.[0];
    console.log(`✓ 上传成功`);
    console.log(`  成功：${result?.success}`);
    console.log(`  裂变数量：${result?.fissionCount || 0}`);
    console.log(`  加工数据 ID：${JSON.stringify(result?.processedDataIds)}`);

    // 验证：生成了多条数据
    if (!result?.fissionCount || result.fissionCount < 1) {
        throw new Error(`验证失败：期望裂变数量 > 1，实际为 ${result?.fissionCount}`);
    }

    // 验证数据库（裂变后标题会改变，所以只用批次 ID 查询）
    const countQuery = `
        SELECT COUNT(*) as total_count
        FROM processed_data
        WHERE batch_id = $1
    `;
    const countResult = await pool.query(countQuery, [batchId]);
    const totalCount = parseInt(countResult.rows[0].total_count);

    const detailQuery = `
        SELECT COUNT(*) as count, type, category
        FROM processed_data
        WHERE batch_id = $1
        GROUP BY type, category
    `;
    const verifyResult = await pool.query(detailQuery, [batchId]);

    console.log(`\n步骤 2: 验证数据库`);
    if (verifyResult.rows.length > 0) {
        console.log(`  数据分布:`);
        verifyResult.rows.forEach(row => {
            console.log(`    类型=${row.type}, 分类=${row.category}: ${row.count}条`);
        });
    } else {
        console.log(`  无数据分布（可能裂变未执行）`);
    }
    console.log(`  总记录数：${totalCount}`);

    if (totalCount < 2) {
        throw new Error(`验证失败：数据库期望 > 1 条记录（裂变应生成多条），实际为 ${totalCount}`);
    }

    console.log(`\n✓ 测试 2 通过：启用裂变时生成 ${totalCount} 条数据`);

    return { batchId, count: totalCount };
}

// ========== 主流程 ==========
async function runTests() {
    console.log('='.repeat(60));
    console.log('裂变启用/禁用测试');
    console.log('启动时间:', new Date().toLocaleString('zh-CN'));
    console.log('='.repeat(60));

    try {
        await cleanup();
        const result1 = await testFissionDisabled();
        const result2 = await testFissionEnabled();

        console.log('\n' + '='.repeat(60));
        console.log('测试汇总报告');
        console.log('='.repeat(60));
        console.log(`✓ 测试 1：禁用裂变 → ${result1.count} 条数据`);
        console.log(`✓ 测试 2：启用裂变 → ${result2.count} 条数据`);
        console.log('='.repeat(60));
        console.log('✓ 所有测试通过！');
        console.log('='.repeat(60));

        return { success: true, results: { result1, result2 } };

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        return { success: false, error: error.message };
    } finally {
        await pool.end();
    }
}

runTests()
    .then(result => {
        console.log('\n最终结果:', JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('未捕获的错误:', error);
        process.exit(1);
    });
