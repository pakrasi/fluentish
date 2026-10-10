/* The progress log's kv name, on its own: the record checker (data/records.js) and the backup's snapshot prefix
   (data/sync/backup.js) need only this pattern at start, and the progress engine (domain/progress.js, which
   re-exports it) is not part of the boot graph (tests/unit/boot-graph.test.mjs). */

/** A month of the log: 'progress.<course id>.<YYYY-MM>' (the backup's prefix rule, data/sync/backup.js). */
export const MONTH_KEY = /^progress\.([a-z0-9-]+)\.(\d{4}-\d\d)$/;
