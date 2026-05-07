require('dotenv').config();
const { Pool } = require('pg');

const NEON_DB_URL = 'postgresql://neondb_owner:npg_Wvxo1yK9XOAe@ep-solitary-breeze-a8g3ekc4-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require';
const postgres = (NEON_DB_URL && NEON_DB_URL.startsWith('postgres')) ? NEON_DB_URL : process.env.DATABASE_URL;

const pg = new Pool({
    connectionString: postgres,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        await pg.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                token VARCHAR(64) PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pg.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) DEFAULT \'\'');
        await pg.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN DEFAULT FALSE');
        await pg.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT \'standard\'');
        await pg.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS config JSONB DEFAULT \'{}\'');
        await pg.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes VARCHAR(50) DEFAULT \'ping\'');
        console.log('Successfully added columns and tables.');
    } catch (e) {
        console.error('Migration error:', e);
    } finally {
        pg.end();
    }
}

migrate();
