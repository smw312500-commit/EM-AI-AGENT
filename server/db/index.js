import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "../mes.db");

const sqlite = new Database(DB_PATH);

// WAL 모드: 동시 읽기 성능 향상
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// 테이블 자동 생성 (마이그레이션 없이 직접 CREATE)
export function initDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id            TEXT PRIMARY KEY,
      order_number  TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      product_type  TEXT NOT NULL,
      quantity      INTEGER NOT NULL,
      job_type      TEXT NOT NULL,
      cutting       TEXT NOT NULL,
      priority      INTEGER NOT NULL,
      status        TEXT NOT NULL,
      due_date      TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      completed_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS raw_stock_receipts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      material_type TEXT NOT NULL,
      quantity      INTEGER NOT NULL,
      received_date TEXT NOT NULL,
      note          TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS first_process_sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id         TEXT REFERENCES orders(id),
      process_type     TEXT NOT NULL,
      work_date        TEXT NOT NULL,
      target_qty       INTEGER NOT NULL,
      output_qty       INTEGER,
      short_qty        INTEGER DEFAULT 0,
      started_at       TEXT,
      ended_at         TEXT,
      status           TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      parent_session_id INTEGER,
      restart_from_qty  INTEGER,
      note             TEXT,
      created_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS second_process_sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id         TEXT REFERENCES orders(id),
      machine_id       INTEGER NOT NULL,
      process_type     TEXT NOT NULL,
      units_per_hour   INTEGER NOT NULL,
      work_date        TEXT NOT NULL,
      target_qty       INTEGER NOT NULL,
      output_qty       INTEGER,
      short_qty        INTEGER DEFAULT 0,
      work_minutes     INTEGER,
      started_at       TEXT,
      ended_at         TEXT,
      status           TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      parent_session_id INTEGER,
      restart_from_qty  INTEGER,
      note             TEXT,
      created_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type    TEXT NOT NULL,
      session_type  TEXT,
      session_id    INTEGER,
      order_id      TEXT,
      machine_id    INTEGER,
      qty           INTEGER,
      material_type TEXT,
      timestamp     TEXT NOT NULL,
      note          TEXT
    );
  `);

  // 기존 DB에 completed_at 컬럼이 없으면 추가 (마이그레이션)
  try {
    sqlite.exec(`ALTER TABLE orders ADD COLUMN completed_at TEXT`);
  } catch {
    // 이미 존재하면 무시
  }

  console.log("✅ DB 초기화 완료:", DB_PATH);
}
