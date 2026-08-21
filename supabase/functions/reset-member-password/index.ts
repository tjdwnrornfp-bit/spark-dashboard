import { createClient } from 'npm:@supabase/supabase-js@2.102.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function characterLength(value: string): number {
  return Array.from(value).length
}

async function passwordToAuthSecret(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`spark-auth-v1:${password}`))
  const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `Sp!${hex}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { ok: false, message: 'POST 요청만 허용됩니다.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { ok: false, message: 'Edge Function 서버 설정을 확인해 주세요.' })
  }

  const authorization = request.headers.get('Authorization') ?? ''
  const accessToken = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) return json(401, { ok: false, message: '로그인이 필요합니다.' })

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await admin.auth.getUser(accessToken)
  const caller = authData.user
  if (authError || !caller) return json(401, { ok: false, message: '로그인 세션을 확인할 수 없습니다.' })

  const { data: callerProfile, error: callerProfileError } = await admin
    .from('profiles')
    .select('id, username, role, approval_status, active')
    .eq('id', caller.id)
    .maybeSingle()

  if (callerProfileError) return json(500, { ok: false, message: '관리자 권한을 확인하지 못했습니다.' })
  if (!callerProfile || callerProfile.role !== 'admin' || callerProfile.approval_status !== 'approved' || callerProfile.active !== true) {
    return json(403, { ok: false, message: '관리자만 회원 비밀번호를 재설정할 수 있습니다.' })
  }

  let payload: { memberId?: unknown; newPassword?: unknown }
  try {
    payload = await request.json()
  } catch {
    return json(400, { ok: false, message: '비밀번호 재설정 요청이 올바르지 않습니다.' })
  }

  const memberId = typeof payload.memberId === 'string' ? payload.memberId.trim() : ''
  const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : ''
  if (!memberId) return json(400, { ok: false, message: '대상 회원을 선택해 주세요.' })
  if (characterLength(newPassword) < 4 || characterLength(newPassword) > 72) {
    return json(400, { ok: false, message: '새 비밀번호는 4자 이상 72자 이하로 입력해 주세요.' })
  }

  const { data: targetProfile, error: targetProfileError } = await admin
    .from('profiles')
    .select('id, username, role')
    .eq('id', memberId)
    .maybeSingle()

  if (targetProfileError) return json(500, { ok: false, message: '대상 회원 정보를 확인하지 못했습니다.' })
  if (!targetProfile) return json(404, { ok: false, message: '대상 회원을 찾을 수 없습니다.' })
  if (targetProfile.role === 'admin') {
    return json(403, { ok: false, message: '관리자 계정은 내 정보에서 현재 비밀번호를 확인한 뒤 변경해 주세요.' })
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(memberId, {
    password: await passwordToAuthSecret(newPassword),
  })
  if (updateError) {
    return json(500, { ok: false, message: updateError.message || '회원 비밀번호를 변경하지 못했습니다.' })
  }

  const resetAt = new Date().toISOString()
  const { error: auditError } = await admin.from('audit_logs').insert({
    actor_id: caller.id,
    actor_username: callerProfile.username || 'admin',
    actor_role: 'admin',
    action: 'member.password_reset',
    entity_type: 'member',
    entity_id: memberId,
    entity_label: targetProfile.username || '',
    metadata: {},
  })

  if (auditError) {
    console.error('member password reset audit insert failed', auditError)
    return json(500, {
      ok: false,
      passwordChanged: true,
      message: '비밀번호는 변경되었지만 감사 기록 저장에 실패했습니다. 운영 로그를 확인해 주세요.',
    })
  }

  return json(200, {
    ok: true,
    memberId,
    username: targetProfile.username || '',
    resetAt,
  })
})
