const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'cache.db');
const db = new Database(dbPath, { fileMustExist: false });

// Initialize schema
db.exec(`
    CREATE TABLE IF NOT EXISTS event_cache (
        event_id INTEGER PRIMARY KEY,
        total_count INTEGER DEFAULT 0,
        history_json TEXT DEFAULT '[]',
        last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

const stmtGet = db.prepare('SELECT * FROM event_cache WHERE event_id = ?');
const stmtSet = db.prepare(`
    INSERT OR REPLACE INTO event_cache (event_id, total_count, history_json, last_synced)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
`);

module.exports = {
    getEvent: (eventId) => {
        try {
            const row = stmtGet.get(eventId);
            if (row) {
                return {
                    total: row.total_count,
                    history: JSON.parse(row.history_json || '[]')
                };
            }
            return null;
        } catch (e) {
            console.error('[CacheDb] Read Error:', e);
            return null;
        }
    },
    setEvent: (eventId, total, history) => {
        try {
            stmtSet.run(eventId, total, JSON.stringify(history));
        } catch (e) {
            console.error('[CacheDb] Write Error:', e);
        }
    },
    close: () => {
        try {
            db.close();
        } catch (e) {
            console.error('[CacheDb] Close Error:', e);
        }
    }
};
