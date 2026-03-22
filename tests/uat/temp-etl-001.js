
const path = require('path');
process.chdir('/home/admin/projects/annsight-data-manager/tests');
const { getTestPool } = require('./tests/db');
const { EtlService } = require('./src/pipeline/etl-service');

(async () => {
    const pool = getTestPool();
    const client = await pool.connect();
    const etlService = new EtlService(pool);
    const text = process.argv[2];
    const result = await etlService.processText(text);
    console.log(JSON.stringify(result));
    client.release();
    process.exit(0);
})().catch(e => {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
});
