import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec(`
  create role anon; create role authenticated;
  create type public.member_role as enum ('admin','agency','distributor');
  create type public.approval_status as enum ('pending','approved','rejected');
  create table public.profiles(username_key text, referral_code text, role public.member_role, approval_status public.approval_status, active boolean);
  alter table public.profiles enable row level security;
  insert into profiles values
    ('manager1','SP123456ABCDEF','agency','approved',true),
    ('agency01','SPAGENCYCODE12','agency','approved',true),
    ('dist0001','SPDISTRIBUTOR1','distributor','approved',true),
    ('admin001','SPADMINCODE123','admin','approved',true),
    ('pending1','SPPENDING12345','agency','pending',false),
    ('inactive','SPINACTIVE1234','agency','approved',false),
    ('rejected','SPREJECTED1234','agency','rejected',false);
`)
const snapshot = async () => (await db.query('select * from profiles order by username_key')).rows
const before = await snapshot()
const migration = fs.readdirSync('supabase/migrations').find(name => name.endsWith('_v10_13_1_signup_code_validation.sql'))
assert.ok(migration)
await db.exec(fs.readFileSync(`supabase/migrations/${migration}`, 'utf8'))
const valid = async code => (await db.query('select public.is_signup_referral_code_valid_v10131($1) as valid', [code])).rows[0].valid
for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`)
  for (const code of ['SP123456ABCDEF', ' sp123456abcdef ', 'MANAGER1', 'SPAGENCYCODE12', 'dist0001']) assert.equal(await valid(code), true, code)
  for (const code of ['SP123456ABCDE', 'unknown', 'SPADMINCODE123', 'SPPENDING12345', 'SPINACTIVE1234', 'SPREJECTED1234', '', ' ', null, 'x'.repeat(121), "' OR true --"]) assert.equal(await valid(code), false, code)
  await assert.rejects(db.query('select * from profiles'), /permission denied/)
  await assert.rejects(db.query("update profiles set active=true"), /permission denied/)
}
await db.exec('reset role')
assert.deepEqual(await snapshot(), before)

let slots = [], cursor = 0
globalThis.signupTestHooks = { useState(initial) {
  const i = cursor++
  if (!(i in slots)) slots[i] = initial
  return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
} }
const { outputFiles } = await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: "export * from './src/lib/signup'; export { AuthPage } from './src/features/AuthPage'" },
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react/jsx-runtime'],
  plugins: [{ name: 'hooks', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'hooks' }))
    b.onLoad({ filter: /.*/, namespace: 'hooks' }, () => ({ contents: 'export const {useState}=globalThis.signupTestHooks;' }))
  } }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { registerRemoteMember, INVALID_SIGNUP_CODE_MESSAGE, SIGNUP_UNAVAILABLE_MESSAGE, AuthPage } = module.exports
let calls = [], rpcError = null, authError = null, overrideData
const client = {
  async rpc(name, args) {
    calls.push('validate')
    assert.equal(name, 'is_signup_referral_code_valid_v10131')
    return { data: rpcError ? null : overrideData === undefined ? await valid(args.p_code) : overrideData, error: rpcError }
  },
  auth: {
    async signUp(payload) { calls.push('signup'); client.payload = payload; return { error: authError } },
    async signOut() { calls.push('signout'); return { error: null } },
  },
}
const draft = { username: '  NewMember  ', phoneNumber: '010-1234-5678', password: 'sample-password', passwordConfirm: 'sample-password', referralCode: 'SP123456ABCDE' }
await db.exec('set role anon')
assert.deepEqual(await registerRemoteMember(client, draft), { ok: false, message: INVALID_SIGNUP_CODE_MESSAGE })
assert.deepEqual(calls, ['validate'], 'invalid code must not create an auth user')
calls = []
assert.equal((await registerRemoteMember(client, { ...draft, referralCode: '  ＳＰ１２３４５６ＡＢＣＤＥＦ  ' })).ok, true)
assert.deepEqual(calls, ['validate', 'signup', 'signout'])
assert.deepEqual(client.payload.options.data, { username: 'NewMember', username_key: 'newmember', phone_number: '01012345678', referral_code: 'SP123456ABCDEF' })
assert.match(client.payload.email, /^u_[a-f0-9]{64}@spark\.invalid$/)
assert.notEqual(client.payload.password, draft.password)
calls = []
assert.equal((await registerRemoteMember(client, { ...draft, referralCode: '  ' })).ok, true)
assert.deepEqual(calls, ['signup', 'signout'], 'optional code still supports existing no-code signup')
rpcError = { message: 'network failure', code: 'PGRST202' }; calls = []
assert.equal((await registerRemoteMember(client, draft)).message, SIGNUP_UNAVAILABLE_MESSAGE)
assert.deepEqual(calls, ['validate'])
rpcError = null; overrideData = null
assert.equal((await registerRemoteMember(client, draft)).message, SIGNUP_UNAVAILABLE_MESSAGE)
overrideData = undefined
authError = { message: 'Database error saving new user', code: 'unexpected_failure' }
calls = []
assert.equal((await registerRemoteMember(client, { ...draft, referralCode: 'manager1' })).message, SIGNUP_UNAVAILABLE_MESSAGE)
assert.deepEqual(calls, ['validate', 'signup'], 'real auth failure must not be labeled a mistyped code')
authError = { message: 'User already registered', code: 'user_already_exists' }
assert.match((await registerRemoteMember(client, { ...draft, referralCode: '' })).message, /이미 사용 중/)
authError = { code: 'over_request_rate_limit' }
assert.match((await registerRemoteMember(client, { ...draft, referralCode: '' })).message, /잠시 후/)
authError = null

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('')
  return tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' ? tree : ''
}
const render = () => { cursor = 0; return AuthPage({ serverMode: true, onLogin: async () => ({ ok: false, message: '' }), onRegister: value => registerRemoteMember(client, value) }) }
let tree = render()
nodes(tree).find(n => n.type === 'button' && text(n) === '회원가입').props.onClick()
tree = render()
for (const [index, value] of ['newmember', '01012345678', 'pass1234', 'pass1234', 'SP123456ABCDE'].entries()) {
  nodes(tree).filter(n => n.type === 'input')[index].props.onChange({ target: { value } })
  tree = render()
}
calls = []
nodes(tree).find(n => n.type === 'button' && text(n) === '가입 신청').props.onClick()
for (let i = 0; i < 100; i++) {
  await new Promise(resolve => setTimeout(resolve, 10))
  tree = render()
  if (text(tree).includes(INVALID_SIGNUP_CODE_MESSAGE)) break
}
assert.ok(text(tree).includes(INVALID_SIGNUP_CODE_MESSAGE), 'real signup component displays the actionable message')
assert.deepEqual(calls, ['validate'])
assert.equal(nodes(tree).filter(n => n.type === 'input')[4].props.value, 'SP123456ABCDE', 'keep input available for correction')
assert.equal(nodes(tree).find(n => n.type === 'button' && text(n) === '가입 신청').props.disabled, false)
await db.exec('reset role')
assert.deepEqual(await snapshot(), before)
await db.close()
console.log('PASS: signup code typo/inactive/pending checks, anonymous read-only access, optional code, signup ordering, safe server errors, and displayed message/input retention')
