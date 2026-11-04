import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
console.log('Apply these in order (supabase db push, or the SQL editor):\n');
for (const f of files) console.log(`  ${f}`);
console.log(`\nThen run supabase/seed.sql, and finally: npm run db:seed -w server`);
