#!/usr/bin/env node
/**
 * Dev-only embedded PostgreSQL (fallback when Docker is unavailable).
 *
 *   node infra/scripts/dev-postgres.mjs up     # start detached, print PID
 *   node infra/scripts/dev-postgres.mjs down   # graceful stop
 *   node infra/scripts/dev-postgres.mjs status
 *
 * Data dir: infra/.pgdata (gitignored). Connection string for apps/api/.env:
 *   DATABASE_URL="postgresql://quickcart:quickcart_dev_password@localhost:5433/quickcart?schema=public"
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, '..', '.pgdata');
const PID_FILE = path.join(DATA_DIR, 'dev-postgres.pid');

const PORT = 5433;
const USER = 'quickcart';
const PASSWORD = 'quickcart_dev_password';
const DATABASE = 'quickcart';

const command = process.argv[2] ?? 'status';

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0); // liveness probe
    return pid;
  } catch {
    return null;
  }
}

async function runServer() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  mkdirSync(DATA_DIR, { recursive: true });
  const initialised = existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    // Windows initdb defaults to the ANSI codepage (e.g. WIN1252), which cannot
    // store ₹ and other currency glyphs. Force UTF-8 with a C locale.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  if (!initialised) {
    process.stdout.write('Initialising embedded Postgres data directory…\n');
    await pg.initialise();
  }
  // Written after initialise: initdb refuses non-empty data directories.
  writeFileSync(PID_FILE, String(process.pid));
  await pg.start();
  if (!initialised) {
    await pg.createDatabase(DATABASE);
  }
  process.stdout.write(
    `Embedded Postgres ready: postgresql://${USER}:***@localhost:${PORT}/${DATABASE}\n` +
      `  PID ${process.pid} — stop with: node infra/scripts/dev-postgres.mjs down\n`,
  );
  const shutdown = async (signal) => {
    process.stdout.write(`\nReceived ${signal}, stopping Postgres…\n`);
    try {
      await pg.stop();
    } finally {
      rmSync(PID_FILE, { force: true });
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  // Hold the process open; postgres runs as its child.
  await new Promise(() => {});
}

async function isPortOpen(host, port, timeoutMs = 750) {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

switch (command) {
  case 'up': {
    const existing = readPid();
    if (existing) {
      process.stdout.write(`Embedded Postgres already running (PID ${existing}).\n`);
      process.exit(0);
    }
    // Detach so the developer's shell is not blocked; the child holds the DB.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'server'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.unref();
    // Poll until the socket is accepting (initdb can take a while on first run).
    let ready = false;
    for (let i = 0; i < 120; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (await isPortOpen('127.0.0.1', PORT)) {
        ready = true;
        break;
      }
    }
    const pid = readPid();
    if (ready && pid) {
      process.stdout.write(`Embedded Postgres ready (PID ${pid}, port ${PORT}).\n`);
    } else {
      process.stderr.write(
        'Embedded Postgres did not become ready. Run "server" mode in the foreground for details:\n',
      );
      process.stderr.write(`  node ${fileURLToPath(import.meta.url)} server\n`);
      process.exit(1);
    }
    break;
  }
  case 'down': {
    const pid = readPid();
    if (!pid) {
      process.stdout.write('Embedded Postgres is not running.\n');
      process.exit(0);
    }
    process.kill(pid, 'SIGTERM');
    process.stdout.write(`Sent SIGTERM to PID ${pid}; waiting for shutdown…\n`);
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!readPid()) {
        process.stdout.write('Stopped.\n');
        process.exit(0);
      }
    }
    process.stderr.write('Server did not exit within 10s — check infra/.pgdata.\n');
    process.exit(1);
    break;
  }
  case 'status': {
    const pid = readPid();
    process.stdout.write(pid ? `Running (PID ${pid}, port ${PORT}).\n` : 'Not running.\n');
    break;
  }
  case 'server': {
    await runServer();
    break;
  }
  default:
    process.stderr.write('Usage: dev-postgres.mjs [up|down|status|server]\n');
    process.exit(2);
}
