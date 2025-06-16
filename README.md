# backup-clickhouse-s3

Node/Docker tool to backup Clickhouse to S3/MinIO using builtin [`BACKUP TABLE`](https://clickhouse.com/docs/operations/backup#configuring-backuprestore-to-use-an-s3-endpoint).
Supports [incremental backups](https://clickhouse.com/docs/operations/backup#take-an-incremental-backup).

# Usage

```shell
CLICKHOUSE_URL='http://localhost:8123'
CLICKHOUSE_USER='default'
CLICKHOUSE_PASSWORD=''
CLICKHOUSE_DATABASE='default'
S3_ENDPOINT='http://localhost:9000'
S3_BUCKET='backups'
S3_ACCESS_KEY='minioadmin'
S3_SECRET_KEY='minioadmin'
BACKUP_INCREMENTAL=true
BACKUP_TABLES='table1,table2,other-db:table3'
node main.mjs
```

For all options see [`main.mjs`](main.mjs).

# Description

- If incremental backups are disabled:
  - Backups will be stored as `<S3_BUCKEt>/<database>/<table>`.
- If incremental backups are enabled:
  - The first backup will be stored as `<S3_BUCKET>/<database>/<table>/<timestamp>_full`.
  - Incremental backups will be stored as `<S3_BUCKET>/<database>/<table>/<timestamp>`.
  - Incremental backups will be based on the last (full or incremental) backup.
- `<database>` is determined by the `database:table` format in `BACKUP_TABLES`, defaulting to the value of `CLICKHOUSE_DATABASE`.
- `<table>` is determined by the `database:table` or `table` format in `BACKUP_TABLES`.
- `<timestamp>` is the current timestamp in `YYYY-MM-DD'T'HH-mm-ss.SSS'Z'` format (ISO 8601 with `:` replaced by `-`). Example: `2025-06-16T13.07.03.251Z`.

