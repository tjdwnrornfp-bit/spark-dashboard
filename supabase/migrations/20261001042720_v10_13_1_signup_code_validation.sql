-- Anonymous signup preflight: return one boolean, never profile data or IDs.
-- This is deliberately callable before auth.uid() exists. SECURITY DEFINER is
-- required to check private profiles without granting anonymous table access.
-- Existing signup trigger, RLS, approval and settlement rules remain unchanged.
create function public.is_signup_referral_code_valid_v10131(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where char_length(trim(coalesce(p_code, ''))) between 1 and 120
      and p.approval_status = 'approved'::public.approval_status
      and p.active = true
      and p.role in ('agency'::public.member_role, 'distributor'::public.member_role)
      and (p.username_key = lower(trim(p_code)) or lower(p.referral_code) = lower(trim(p_code)))
  );
$$;

revoke all on function public.is_signup_referral_code_valid_v10131(text) from public;
grant execute on function public.is_signup_referral_code_valid_v10131(text) to anon, authenticated;
comment on function public.is_signup_referral_code_valid_v10131(text) is
  'Anonymous signup code validity only; returns no profile data. Does not grant signup, approval, or settlement permissions.';
