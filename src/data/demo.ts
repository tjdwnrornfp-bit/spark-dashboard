import type { AppSettings, Notice, NotificationItem, Order, PaymentStep, User } from '../domain/types'
import { addDays, todayInSeoul } from '../lib/date'
import { calculateAmount } from '../lib/money'

const ADMIN_HASH = 'ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270'
const USER_HASH = 'bd94dcda26fccb4e68d6a31f9b5aac0b571ae266d822620e901ef7ebe3a11d4f'

function memberBase(partial: Partial<User> & Pick<User, 'id' | 'username' | 'role' | 'approvalStatus' | 'pricePerShot' | 'active'>): User {
  return {
    passwordHash: USER_HASH,
    requestedAt: '2026-07-10T02:10:00.000Z',
    approvedAt: partial.approvalStatus === 'approved' ? '2026-07-10T04:00:00.000Z' : null,
    updatedAt: '2026-07-10T04:00:00.000Z',
    sponsorId: null,
    sponsorUsername: null,
    referralCode: `SP${partial.id.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
    groupName: '',
    hierarchyDepth: 0,
    bank: '',
    accountNumber: '',
    accountHolder: '',
    ...partial,
  }
}

export const DEMO_USERS: User[] = [
  memberBase({ id: 'admin-demo', username: 'admin', passwordHash: ADMIN_HASH, role: 'admin', approvalStatus: 'approved', pricePerShot: 0, active: true, referralCode: 'ADMIN', groupName: '관리자' }),
  memberBase({ id: 'distributor-demo', username: 'dist1', role: 'distributor', approvalStatus: 'approved', pricePerShot: 80, active: true, groupName: 'A그룹', bank: '국민은행', accountNumber: '111-222-333333', accountHolder: '총판 데모' }),
  memberBase({ id: 'agency-demo', username: 'agency1', role: 'agency', approvalStatus: 'approved', pricePerShot: 100, active: true, sponsorId: 'distributor-demo', sponsorUsername: 'dist1', hierarchyDepth: 1, groupName: 'A그룹', bank: '신한은행', accountNumber: '444-555-666666', accountHolder: '대행사 데모' }),
  memberBase({ id: 'subagency-demo', username: 'agency2', role: 'agency', approvalStatus: 'approved', pricePerShot: 120, active: true, sponsorId: 'agency-demo', sponsorUsername: 'agency1', hierarchyDepth: 2, groupName: 'A그룹' }),
  memberBase({ id: 'pending-demo', username: 'newagency', role: 'agency', approvalStatus: 'pending', pricePerShot: 0, active: false, sponsorId: 'agency-demo', sponsorUsername: 'agency1', hierarchyDepth: 2, groupName: 'A그룹', requestedAt: new Date().toISOString(), approvedAt: null, updatedAt: new Date().toISOString() }),
]

function orderBase(partial: Pick<Order, 'id' | 'createdBy' | 'creatorUsername' | 'sponsorId' | 'sponsorUsername' | 'creatorGroupName' | 'placeUrl' | 'mid' | 'storeName' | 'keyword' | 'dailyShots' | 'operationDays' | 'pricePerShot' | 'startDate' | 'endDate' | 'status'>): Order {
  const amount = calculateAmount(partial.dailyShots, partial.operationDays, partial.pricePerShot)
  const createdAt = new Date(Date.now() - 86_400_000).toISOString()
  return {
    ...partial,
    createdAt,
    ...amount,
    memo: '',
    activatedAt: partial.status === '구동중' ? new Date(`${partial.startDate}T00:00:00+09:00`).toISOString() : null,
    stoppedAt: partial.status === '정지' ? new Date().toISOString() : null,
    paymentNotifiedAt: partial.status === '입금대기' ? null : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function makeDemoOrders(): Order[] {
  const today = todayInSeoul()
  return [
    orderBase({ id: `SP-${today.replaceAll('-', '')}-0001`, createdBy: 'agency-demo', creatorUsername: 'agency1', sponsorId: 'distributor-demo', sponsorUsername: 'dist1', creatorGroupName: 'A그룹', placeUrl: 'https://m.place.naver.com/place/1250872931/home', mid: '1250872931', storeName: '로나파티', keyword: '셀프촬영풍선', dailyShots: 100, operationDays: 30, pricePerShot: 100, startDate: addDays(today, -1), endDate: addDays(today, 28), status: '구동중' }),
    orderBase({ id: `SP-${today.replaceAll('-', '')}-0002`, createdBy: 'subagency-demo', creatorUsername: 'agency2', sponsorId: 'agency-demo', sponsorUsername: 'agency1', creatorGroupName: 'A그룹', placeUrl: 'https://m.place.naver.com/place/9876543210/home', mid: '9876543210', storeName: '그린팜', keyword: '유기농야채배송', dailyShots: 300, operationDays: 20, pricePerShot: 120, startDate: today, endDate: addDays(today, 19), status: '구동중' }),
    orderBase({ id: `SP-${today.replaceAll('-', '')}-0003`, createdBy: 'distributor-demo', creatorUsername: 'dist1', sponsorId: null, sponsorUsername: null, creatorGroupName: 'A그룹', placeUrl: 'https://m.place.naver.com/place/1122334455/home', mid: '1122334455', storeName: '핸드메이드샵', keyword: '케이크토퍼주문', dailyShots: 150, operationDays: 14, pricePerShot: 80, startDate: addDays(today, 1), endDate: addDays(today, 14), status: '입금완료' }),
    orderBase({ id: `SP-${today.replaceAll('-', '')}-0004`, createdBy: 'agency-demo', creatorUsername: 'agency1', sponsorId: 'distributor-demo', sponsorUsername: 'dist1', creatorGroupName: 'A그룹', placeUrl: 'https://m.place.naver.com/place/5566778899/home', mid: '5566778899', storeName: '스타일샵', keyword: '여름린넨원피스', dailyShots: 75, operationDays: 7, pricePerShot: 100, startDate: addDays(today, 1), endDate: addDays(today, 7), status: '입금대기' }),
  ]
}

export function makeDemoPaymentSteps(orders = makeDemoOrders()): PaymentStep[] {
  const members = DEMO_USERS
  const admin = members.find((member) => member.role === 'admin')!
  const steps: PaymentStep[] = []
  for (const order of orders) {
    let payer = members.find((member) => member.id === order.createdBy)!
    let stepOrder = 1
    while (payer.role !== 'admin') {
      const payee = payer.sponsorId ? members.find((member) => member.id === payer.sponsorId)! : admin
      const amount = calculateAmount(order.dailyShots, order.operationDays, payer.pricePerShot)
      steps.push({
        id: `${order.id}-step-${stepOrder}`,
        orderDbId: order.id,
        orderNumber: order.id,
        storeName: order.storeName,
        stepOrder,
        payerId: payer.id,
        payerUsername: payer.username,
        payeeId: payee.id,
        payeeUsername: payee.username,
        unitPrice: payer.pricePerShot,
        ...amount,
        confirmedAt: order.status === '입금대기' ? null : new Date().toISOString(),
        createdAt: order.createdAt,
      })
      if (payee.role === 'admin') break
      payer = payee
      stepOrder += 1
    }
  }
  return steps
}

export const DEMO_NOTIFICATIONS: NotificationItem[] = [
  { id: 'notification-pending', createdAt: new Date().toISOString(), userId: 'agency-demo', role: 'agency', title: '하위 대행사 승인 요청', message: 'newagency 회원의 가입 승인이 필요합니다.', read: false },
  { id: 'notification-order-admin', createdAt: new Date(Date.now() - 1_800_000).toISOString(), userId: 'admin-demo', role: 'admin', title: '새 작업 접수', message: 'agency1 회원이 로나파티 작업을 접수했습니다.', read: false },
]

export const DEMO_NOTICES: Notice[] = [
  { id: 'notice-1', title: '작업 시작일을 익일부터 직접 지정할 수 있습니다.', content: '입금완료 상태인 작업은 지정한 시작일 자정에 구동중으로 변경됩니다.', pinned: true, createdAt: '2026-07-29T01:00:00.000Z' },
  { id: 'notice-2', title: '작업 접수 URL과 키워드를 다시 확인해 주세요.', content: '접수 완료 후 URL 및 키워드 변경은 관리자에게 요청해 주세요.', pinned: false, createdAt: '2026-07-20T01:00:00.000Z' },
]

export const DEFAULT_SETTINGS: AppSettings = {
  cutoffHour: 18,
  autoStartHour: 0,
  bank: '국민은행',
  accountNumber: '123456-01-123456',
  accountHolder: '주식회사 스파크',
}
