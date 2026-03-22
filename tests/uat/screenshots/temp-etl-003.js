
const { getTestPool } = require('./tests/db');
const { EtlService } = require('./src/pipeline/etl-service');

(async () => {
    const pool = getTestPool();
    const client = await pool.connect();
    const etlService = new EtlService(pool);
    const result = await etlService.processRawData('non-existent');
    console.log(JSON.stringify(result));
    client.release();
    process.exit(0);
})().catch(e => {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
});
