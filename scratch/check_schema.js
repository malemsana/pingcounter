const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: 'postgresql://neondb_owner:npg_Wvxo1yK9XOAe@ep-solitary-breeze-a8g3ekc4-pooler.eastus2.azure.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false } 
});

async function checkSchema() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'projects';
    `);
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSchema();
