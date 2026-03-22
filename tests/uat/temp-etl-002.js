
const path = require('path');
process.chdir('/home/admin/projects/annsight-data-manager/tests');
const { getTestPool } = require('./tests/db');
const { EtlService } = require('./src/pipeline/etl-service');

(async () => {
    const pool = getTestPool();
    const client = await pool.connect();
    const etlService = new EtlService(pool);
    const text = process.argv[2];
    const r1 = await etlService.processText(text);
    const r2 = await etlService.processText(text);
    console.log(JSON.stringify({
        first: { success: r1.success, context: r1.context },
        second: { isDuplicate: r2.isDuplicate, duplicateOf: r2.duplicateOf },
        isDuplicate: r2.isDuplicate
    }));
    client.release();
    process.exit(0);
})().catch(e => {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
});
