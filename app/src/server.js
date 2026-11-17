'use strict';

const express = require('express');
const mysql = require('mysql2/promise');
const { createClient } = require('redis');

const PORT = Number(process.env.PORT || 3000);
const API_VERSION = process.env.API_VERSION || '1.0.0';
const CACHE_TTL = Number(process.env.CACHE_TTL || 30);
const CACHE_KEY = 'products:all';
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 2000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'loja',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'lojadb',
  waitForConnections: true,
  connectionLimit: 5
});

function createRedisClient() {
  const client = createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${Number(process.env.REDIS_PORT || 6379)}`
  });
  client.on('error', (err) => console.error('[redis] erro:', err.message));
  client.on('ready', () => console.log('[redis] conexao estabelecida'));
  return client;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let redis = createRedisClient();
let server;

async function waitForDependencies() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      console.log('[mysql] conexao estabelecida');
      break;
    } catch (err) {
      console.warn(`[mysql] aguardando (${attempt}/${MAX_RETRIES}): ${err.message}`);
      if (attempt === MAX_RETRIES) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    if (redis.isReady) return;
    try {
      await redis.connect();
      return;
    } catch (err) {
      console.warn(`[redis] aguardando (${attempt}/${MAX_RETRIES}): ${err.message}`);
      if (attempt === MAX_RETRIES) throw err;
      try {
        redis.disconnect();
      } catch (disconnectErr) {
        console.error('[redis] erro ao descartar conexao:', disconnectErr.message);
      }
      redis = createRedisClient();
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      price DECIMAL(10,2) NOT NULL
    )
  `);

  const [rows] = await pool.query('SELECT COUNT(*) AS total FROM products');
  if (Number(rows[0].total) === 0) {
    await pool.query(
      'INSERT INTO products (name, price) VALUES (?, ?), (?, ?)',
      ['Teclado', 120.5, 'Mouse', 45.9]
    );
    console.log('[mysql] produtos de exemplo inseridos');
  }
}

async function shutdown(signal) {
  console.log(`[api] sinal ${signal} recebido, encerrando...`);
  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref();

  const closeResources = async () => {
    try {
      if (redis.isReady) await redis.quit();
    } catch (err) {
      console.error('[redis] erro ao encerrar:', err.message);
    }
    try {
      await pool.end();
    } catch (err) {
      console.error('[mysql] erro ao encerrar:', err.message);
    }
    clearTimeout(forceExit);
    process.exit(0);
  };

  if (server) {
    server.close(closeResources);
  } else {
    await closeResources();
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function start() {
  await waitForDependencies();
  await initDb();

  const app = express();

  app.use((req, res, next) => {
    res.setHeader('X-API-Version', API_VERSION);
    next();
  });

  app.get('/', (req, res) => {
    res.json({
      message: 'Loja API funcionando',
      version: API_VERSION
    });
  });

  app.get('/health', async (req, res) => {
    const status = { api: 'ok', mysql: 'down', redis: 'down' };
    let httpStatus = 200;

    try {
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      status.mysql = 'ok';
    } catch (err) {
      console.error('[health] mysql indisponivel:', err.message);
      httpStatus = 503;
    }

    try {
      if (redis.isReady) {
        const pong = await redis.ping();
        status.redis = pong === 'PONG' ? 'ok' : 'down';
      }
    } catch (err) {
      console.error('[health] redis indisponivel:', err.message);
      status.redis = 'down';
    }

    if (status.redis !== 'ok') httpStatus = 503;
    res.status(httpStatus).json(status);
  });

  app.get('/products', async (req, res) => {
    try {
      if (redis.isReady) {
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
          return res.json({ source: 'cache', products: JSON.parse(cached) });
        }
      }

      const [products] = await pool.query('SELECT id, name, price FROM products ORDER BY id');

      if (redis.isReady) {
        await redis.set(CACHE_KEY, JSON.stringify(products), { EX: CACHE_TTL });
      }

      return res.json({ source: 'mysql', products });
    } catch (err) {
      console.error('[products] erro:', err.message);
      return res.status(500).json({ error: 'Erro ao consultar produtos' });
    }
  });

  app.use((err, req, res, next) => {
    console.error('[api] erro nao tratado:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  });

  server = app.listen(PORT, () => {
    console.log(`[api] versao ${API_VERSION} ouvindo na porta ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[api] falha na inicializacao:', err.message);
  process.exit(1);
});
