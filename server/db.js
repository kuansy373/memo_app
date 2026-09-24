const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Database initialized');
}

module.exports = { pool, init };
