const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: 'postgresql://neondb_owner:npg_Wvxo1yK9XOAe@ep-solitary-breeze-a8g3ekc4-pooler.eastus2.azure.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false } 
});

async function migrate() {
  try {
    await pool.query(`
      ALTER TABLE projects 
      ADD COLUMN IF NOT EXISTS allowed_origins TEXT,
      ADD COLUMN IF NOT EXISTS allowed_ips TEXT;
    `);
    console.log('Migration successful: added allowed_origins and allowed_ips to projects table.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

migrate();
