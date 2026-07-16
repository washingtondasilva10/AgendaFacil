const { Pool } = require('pg');

function criarConfiguracao() {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.POSTGRES_URL ||
    '';

  const usarSSL =
    process.env.DB_SSL === 'true' ||
    process.env.NODE_ENV === 'production' ||
    /railway|supabase|neon|render/i.test(connectionString) ||
    /railway|supabase|neon|render/i.test(process.env.DB_HOST || '');

  const ssl = usarSSL
    ? {
        rejectUnauthorized: false
      }
    : false;

  if (connectionString) {
    return {
      connectionString,
      ssl,
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    };
  }

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  };
}

const pool = new Pool(criarConfiguracao());

pool.on('error', (erro) => {
  console.error('❌ Erro inesperado no PostgreSQL:', erro);
});

module.exports = pool;