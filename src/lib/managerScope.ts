import type { User } from '../domain/types'

/** Read scope only: never use this helper to authorize approvals or price edits. */
export function managerScopeMembers(user: User, members: User[]): User[] {
  if (!user.isOperationsManager || !user.active || user.approvalStatus !== 'approved') return []
  const eligible = (member: User) => member.id !== user.id && !member.isOperationsManager
    && (member.role === null || member.role === 'agency' || member.role === 'distributor')
  const children = new Map<string, User[]>()
  for (const member of members) {
    if (!eligible(member) || !member.sponsorId) continue
    const bucket = children.get(member.sponsorId) ?? []
    bucket.push(member)
    children.set(member.sponsorId, bucket)
  }
  const queue = members.filter(member => eligible(member) && member.managerId === user.id)
  const seen = new Map<string, User>()
  for (let index = 0; index < queue.length; index += 1) {
    const member = queue[index]
    if (seen.has(member.id)) continue
    seen.set(member.id, member)
    for (const child of children.get(member.id) ?? []) {
      if (!child.managerId || child.managerId === user.id) queue.push(child)
    }
  }
  return [...seen.values()]
}
