/**
 * SometeoPR Database Layer
 * Wraps @tauri-apps/plugin-sql to provide a simple query interface.
 */
import Database from '@tauri-apps/plugin-sql';

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:someteopr.db');
  }
  return _db;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

export async function execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number; lastInsertId: number }> {
  const db = await getDb();
  const result = await db.execute(sql, params);
  return result as unknown as { rowsAffected: number; lastInsertId: number };
}

/** Parse JSON columns that are stored as TEXT */
export function parseJson<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val !== 'string') return val as T;
  try { return JSON.parse(val) as T; } catch { return fallback; }
}

/** Generate a claim number */
export function generateClaimNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `CLM-${date}-${rand}`;
}

/** Get today's date as YYYY-MM-DD */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
