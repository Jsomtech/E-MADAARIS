/**
 * Every migration in this project is pasted by hand into the Supabase SQL editor, so a typo is only
 * discovered against the live database. This parses the files with Postgres' own grammar (libpg-query)
 * and validates PL/pgSQL function bodies separately, because the SQL parser treats a function body
 * as an opaque string.
 *
 *   npm run db:sql:check                      # every file in supabase/migrations + seed.sql
 *   npm run db:sql:check -- 0022_elections    # only files whose name contains the argument
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('libpg-query');

const MIGRATIONS = resolve(import.meta.dirname, '../../../supabase/migrations');
const filter = process.argv.slice(2);

function matches(name) {
  if (!filter.length) return true;
  return filter.some((f) => name.includes(f));
}

function errorLine(sql, cursor) {
  if (typeof cursor !== 'number' || cursor < 0) return '';
  return ` (line ${sql.slice(0, cursor).split('\n').length})`;
}

const files = [
  ...readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && matches(f)).sort().map((f) => join(MIGRATIONS, f)),
  ...(matches('seed.sql') ? [resolve(MIGRATIONS, '../seed.sql')] : []),
].filter((f) => (existsSync(f) ? true : (console.log(`missing ${f}`), false)));

let failures = 0;
for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  try {
    const out = await pg.parse(sql);
    console.log(`sql   ok    ${file}  (${(out.stmts || []).length} statements)`);
  } catch (e) {
    failures += 1;
    console.error(`sql   FAIL  ${file}${errorLine(sql, e.cursor)}: ${String(e.message).replace(/\s+/g, ' ')}`);
  }
  for (const [, name, args, body] of sql.matchAll(
    /create or replace function\s+([a-z_.]+)\(([^)]*)\)[\s\S]*?\$\$\s*([\s\S]*?)\s*\$\$/gi,
  )) {
    // Trigger bodies that read NEW.<col> need a table context the checker cannot give them.
    if (/^\s*(return|begin)\s+new\./i.test(body)) continue;
    try {
      await pg.parsePlPgSQL(`create function ${name}(${args}) returns int language plpgsql as $q$${body}$q$;`);
      console.log(`plpgsql ok    ${name}()`);
    } catch (e) {
      failures += 1;
      console.error(`plpgsql FAIL  ${name}(): ${String(e.message).replace(/\s+/g, ' ')}`);
    }
  }
}

console.log(failures ? `\n${failures} problem(s)` : `\n${files.length} file(s) parse cleanly`);
process.exit(failures ? 1 : 0);
