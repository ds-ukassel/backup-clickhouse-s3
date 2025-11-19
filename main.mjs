import {createClient} from "@clickhouse/client";
import * as Minio from "minio";

const {
    /** Clickhouse connection URL. Must use the HTTP or HTTPS protocol. */
    CLICKHOUSE_URL = 'http://localhost:8123',
    CLICKHOUSE_USER = 'default',
    CLICKHOUSE_PASSWORD = 'default',
    CLICKHOUSE_DATABASE = 'default',

    /** S3 endpoint URL, including protocol (http or https) and (optional) port, but without bucket name. */
    S3_ENDPOINT = 'http://localhost:9000',
    /**
     * S3 endpoint URL for local MinIO, if different from the hostname used within Clickhouse.
     * This is useful if you run Clickhouse and MinIO in a container but this script on the host.
     *
     * Example: `http://localhost:9000` to access MinIO from the host,
     * with `S3_ENDPOINT` set to `http://minio:9000` as used within the Clickhouse container.
     */
    S3_ENDPOINT_LOCAL,
    S3_BUCKET = 'backups',
    S3_ACCESS_KEY = 'minioadmin',
    S3_SECRET_KEY = 'minioadmin',

    /**
     * Comma-separated list of tables to backup.
     * Can be qualified with database name, e.g. "db1.table1,db2.table2".
     */
    BACKUP_TABLES = '',
    /**
     * Set to any non-empty string to enable incremental backup.
     */
    BACKUP_INCREMENTAL,
} = process.env;

async function main() {
    const timestamp = new Date().toISOString().replace(/:/g, '.');

    const ch = createClient({
        url: CLICKHOUSE_URL,
        username: CLICKHOUSE_USER,
        password: CLICKHOUSE_PASSWORD,
        database: CLICKHOUSE_DATABASE,
    });
    const pingResult = await ch.ping();
    if (!pingResult.success) {
        throw new Error(`Failed to connect to Clickhouse at ${CLICKHOUSE_URL}`, {cause: pingResult.error});
    }

    const minioUrl = new URL(S3_ENDPOINT_LOCAL || S3_ENDPOINT);
    const minio = new Minio.Client({
        endPoint: minioUrl.hostname,
        port: +(minioUrl.port || (minioUrl.protocol === 'https:' ? 443 : 80)),
        useSSL: minioUrl.protocol === 'https:',
        accessKey: S3_ACCESS_KEY,
        secretKey: S3_SECRET_KEY,
    });
    if (!await minio.bucketExists(S3_BUCKET)) {
        throw new Error(`Bucket ${S3_BUCKET} does not exist on S3 endpoint ${S3_ENDPOINT}. Please create it first.`);
    }

    const tables = BACKUP_TABLES.split(',').map(table => table.trim()).filter(Boolean);
    if (tables.length === 0) {
        throw new Error('No tables specified for backup. Set BACKUP_TABLES environment variable.');
    }

    for (const dbTable of tables) {
        const [db, table] = dbTable.includes('.') ? dbTable.split('.') : [CLICKHOUSE_DATABASE, dbTable];
        console.log(`Backing up table ${db}.${table}...`);

        const target = `${S3_ENDPOINT}/${S3_BUCKET}/${objectName(db, table)}`;
        let result;
        if (BACKUP_INCREMENTAL) {
            console.log(`Checking for existing backup for ${db}.${table} at ${target}/...`);

            const objects = await minio.listObjects(S3_BUCKET, objectName(db, table) + '/', false).toArray();
            const lastBackup = objects.reduce((acc, obj) => !acc || obj.prefix > acc.prefix ? obj : acc, null);
            let newTarget = `${target}/${timestamp}`;
            if (lastBackup) {
                const base = `${S3_ENDPOINT}/${S3_BUCKET}/${lastBackup.prefix.slice(0, -1)}`; // Remove trailing slash
                console.log(`Creating incremental backup for ${db}.${table} at ${newTarget} based on ${base}...`);
                result = await backup(ch, db, table, newTarget, base);
            } else {
                newTarget += '_full';
                console.log(`No existing backup found for ${db}.${table}. Creating full backup at ${newTarget} ...`);
                result = await backup(ch, db, table, newTarget);
            }
        } else {
            console.log(`Creating full backup for ${db}.${table} at ${target}...`);
            result = await backup(ch, db, table, target);
        }

        console.log(`Backup of ${db}.${table} completed.`, result);
    }
}

function objectName(db, table) {
    return `${db}/${table}`;
}

async function backup(ch, db, table, target, base = undefined) {
    let query = `BACKUP TABLE "${db}"."${table}" TO S3({target: String}, {access_key: String}, {secret_key: String})`;
    const query_params = {
        target,
        access_key: S3_ACCESS_KEY,
        secret_key: S3_SECRET_KEY,
    }
    if (base) {
        query += ` SETTINGS base_backup = S3({target_base: String}, {access_key: String}, {secret_key: String})`;
        query_params.target_base = base;
    }

    // https://clickhouse.com/docs/operations/backup#take-an-incremental-backup
    return ch.query({
        query,
        query_params,
        format: 'JSONEachRow',
    }).then(r => r.json());
}

if (process.argv[1] === import.meta.filename) {
    try {
        await main();
        console.log('Backup completed successfully.');
    } catch (error) {
        console.error('Error during backup:', error);
        process.exit(1);
    }
}
