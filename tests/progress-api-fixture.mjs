import { readFileSync, readdirSync } from 'node:fs'
export const progressFixture = [
  readFileSync('tests/fixtures/v105-intake.sql', 'utf8'),
  'create role service_role; create schema spark_private;',
  readFileSync('supabase/migrations/' + readdirSync('supabase/migrations').find(f => f.endsWith('_v10_15_member_progress_api.sql')), 'utf8'),
].join('\n')
if (process.argv.includes('--dump')) process.stdout.write(progressFixture)
