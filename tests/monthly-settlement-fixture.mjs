import { readFileSync,readdirSync } from 'node:fs'
export const base=readFileSync('tests/fixtures/v105-intake.sql','utf8')+'\ncreate role service_role;create schema spark_private;'
export const migration=readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(f=>f.endsWith('_v10_16_monthly_settlement.sql')),'utf8')
if(process.argv.includes('--dump'))process.stdout.write(base+'\n'+migration)
