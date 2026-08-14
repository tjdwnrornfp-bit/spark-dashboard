import type { AppSettings, Notice, NotificationItem, Order, PaymentStep, User } from '../domain/types'

const ADMIN_HASH = 'ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270'
const USER_HASH = 'bd94dcda26fccb4e68d6a31f9b5aac0b571ae266d822620e901ef7ebe3a11d4f'

function memberBase(partial: Partial<User> & Pick<User, 'id' | 'username' | 'role' | 'approvalStatus' | 'active'>): User {
  return {
    passwordHash: USER_HASH,
    phoneNumber: '',
    requestedAt: '2026-07-10T02:10:00.000Z',
    approvedAt: partial.approvalStatus === 'approved' ? '2026-07-10T04:00:00.000Z' : null,
    updatedAt: '2026-07-10T04:00:00.000Z',
    sponsorId: null,
    sponsorUsername: null,
    isOperationsManager: false,
    managerId: null,
    managerUsername: null,
    referralCode: `SP${partial.id.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    groupName: '',
    hierarchyDepth: 0,
    bank: '',
    accountNumber: '',
    accountHolder: '',
    pricePerShot: 0,
    sparkPricePerShot: 0,
    sparkPlusPricePerShot: 0,
    sparkSPricePerShot: 0,
    ...partial,
  }
}

export const DEMO_USERS: User[] = [
  memberBase({ id: 'admin-demo', username: 'admin', passwordHash: ADMIN_HASH, role: 'admin', approvalStatus: 'approved', active: true, referralCode: 'ADMIN', groupName: '관리자' }),
  memberBase({ id: 'distributor-demo', username: 'dist1', phoneNumber: '01011112222', role: 'distributor', approvalStatus: 'approved', active: true, groupName: 'A그룹', bank: '국민은행', accountNumber: '111-222-333333', accountHolder: '총판 데모', pricePerShot: 80, sparkPricePerShot: 80, sparkPlusPricePerShot: 95, sparkSPricePerShot: 110 }),
  memberBase({ id: 'agency-demo', username: 'agency1', phoneNumber: '01033334444', role: 'agency', approvalStatus: 'approved', active: true, sponsorId: 'distributor-demo', sponsorUsername: 'dist1', hierarchyDepth: 1, groupName: 'A그룹', bank: '신한은행', accountNumber: '444-555-666666', accountHolder: '대행사 데모', pricePerShot: 100, sparkPricePerShot: 100, sparkPlusPricePerShot: 120, sparkSPricePerShot: 140 }),
  memberBase({ id: 'subagency-demo', username: 'agency2', phoneNumber: '01055556666', role: 'agency', approvalStatus: 'approved', active: true, sponsorId: 'agency-demo', sponsorUsername: 'agency1', hierarchyDepth: 2, groupName: 'A그룹', pricePerShot: 120, sparkPricePerShot: 120, sparkPlusPricePerShot: 140, sparkSPricePerShot: 160 }),
  memberBase({ id: 'pending-demo', username: 'newagency', phoneNumber: '01077778888', role: 'agency', approvalStatus: 'pending', active: false, sponsorId: 'agency-demo', sponsorUsername: 'agency1', hierarchyDepth: 2, groupName: 'A그룹', requestedAt: new Date().toISOString(), approvedAt: null, updatedAt: new Date().toISOString() }),
]

export function makeDemoOrders(): Order[] {
  return []
}

export function makeDemoPaymentSteps(): PaymentStep[] {
  return []
}

export const DEMO_NOTIFICATIONS: NotificationItem[] = []

export const DEMO_NOTICES: Notice[] = [
  { id: 'notice-1', title: '스파크 · 스파크 + · 스파크S 접수를 각각 분리해 운영할 수 있습니다.', content: '프로그램별 단가를 회원관리에서 따로 지정하고, 각 접수 탭에서 개별/엑셀 업로드를 진행하세요.', pinned: true, createdAt: '2026-07-31T01:00:00.000Z' },
  { id: 'notice-2', title: '엑셀 일괄 접수 시작일은 입력한 날짜 그대로 반영됩니다.', content: '시작일 셀은 yyyy-mm-dd 형식 또는 엑셀 날짜 서식을 사용하면 됩니다.', pinned: false, createdAt: '2026-07-31T02:00:00.000Z' },
]

export const DEFAULT_SETTINGS: AppSettings = {
  cutoffHour: 18,
  autoStartHour: 0,
  bank: '국민은행',
  accountNumber: '123456-01-123456',
  accountHolder: '주식회사 스파크',
}
