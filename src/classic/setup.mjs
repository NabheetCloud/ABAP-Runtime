// Database setup of the classic ABAP engine (called by the transpiled init.mjs): the app's own SQLite file,
// shared with the RAP runtime. RAP_CLASSIC_DB names the file; without it an in-memory database is used.
// RAP_CLASSIC_EXTERNALS names the list of other apps' tables the programs read (build.mjs).
import fs from 'node:fs';
import { AppDatabaseClient } from './db.mjs';

export async function setupDatabase(abap, schemas, insert) {
  const db = new AppDatabaseClient(process.env.RAP_CLASSIC_DB || ':memory:', { trace: !!process.env.RAP_CLASSIC_TRACE });
  abap.context.databaseConnections.DEFAULT = db;
  await db.connect();
  // other apps' tables: read-only views on the owner's database instead of local tables
  let externals = [];
  try { externals = JSON.parse(fs.readFileSync(process.env.RAP_CLASSIC_EXTERNALS, 'utf8')); } catch {}
  db.attachExternals(externals);
  await db.createMissing(schemas.sqlite, new Set(externals.map(x => x.name)));
  // repository contents (REPOSRC, T100 messages, ...): refreshed on every start. The object directory and the sources
  // come completely from this build: emptied first, so a deleted program does not stay in TADIR (the program
  // discovery would then look for its class and fail for every program)
  for (const t of ['tadir', 'reposrc']) { try { await db.execute(`DELETE FROM "${t}"`); } catch {} }
  await db.upsert(insert);
}
