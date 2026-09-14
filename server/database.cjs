const { Pool } = require('pg');
function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) return null;
  const pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 });
  pool.on('error', () => {}); // Never log connection strings or upstream details.
  return {
    query: (sql, args) => pool.query(sql, args),
    async transaction(fn) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
module.exports = { createDatabase };
