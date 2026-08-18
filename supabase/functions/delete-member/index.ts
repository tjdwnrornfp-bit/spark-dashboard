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
    return json(403, { ok: false, message: '관리자만 계정을 영구 삭제할 수 있습니다.' })
  }

  let payload: { memberId?: unknown }
  try {
    payload = await request.json()
  } catch {
    return json(400, { ok: false, message: '삭제할 회원 정보가 올바르지 않습니다.' })
  }

  const memberId = typeof payload.memberId === 'string' ? payload.memberId.trim() : ''
  if (!memberId) return json(400, { ok: false, message: '삭제할 회원을 선택해 주세요.' })
  if (memberId === caller.id) return json(400, { ok: false, message: '현재 로그인한 관리자 계정은 삭제할 수 없습니다.' })

  const { data: checkData, error: checkError } = await admin.rpc('member_deletion_check_core_v95', {
    p_member_id: memberId,
  })

  if (checkError) {
    return json(400, { ok: false, message: checkError.message || '계정 삭제 가능 여부를 확인하지 못했습니다.' })
  }

  const check = (checkData ?? {}) as Record<string, unknown>
  const username = typeof check.username === 'string' ? check.username : ''
  const canDelete = check.can_delete === true
  const reasons = Array.isArray(check.reasons) ? check.reasons.filter((value): value is string => typeof value === 'string') : []

  if (!canDelete) {
    return json(409, {
      ok: false,
      message: reasons.length > 0
        ? `운영 이력이 있어 삭제할 수 없습니다. (${reasons.join(', ')})`
        : '운영 이력이 있어 삭제할 수 없습니다.',
      reasons,
    })
  }

  // Hard delete is required so that the deterministic auth email generated from the username can be used again.
  const { error: deleteError } = await admin.auth.admin.deleteUser(memberId, false)
  if (deleteError) {
    return json(500, { ok: false, message: deleteError.message || '로그인 계정을 삭제하지 못했습니다.' })
  }

  const deletedAt = new Date().toISOString()

  // Keep only non-sensitive deletion metadata in the immutable audit trail.
  const { error: auditError } = await admin.from('audit_logs').insert({
    actor_id: caller.id,
    actor_username: callerProfile.username || 'admin',
    actor_role: 'admin',
    action: 'member.permanent_delete',
    entity_type: 'member',
    entity_id: memberId,
    entity_label: username,
    metadata: {
      deleted_username: username,
      deleted_at: deletedAt,
      delete_mode: 'hard',
      username_reusable: true,
    },
  })

  if (auditError) console.error('member deletion audit insert failed', auditError)

  return json(200, {
    ok: true,
    memberId,
    username,
    deletedAt,
    auditRecorded: !auditError,
  })
})
