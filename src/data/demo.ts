import type { AppSettings, Notice, NotificationItem, Order, User } from '../domain/types'
import { addDays, todayInSeoul } from '../lib/date'
import { calculateAmount } from '../lib/money'

const ADMIN_HASH = 'ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270'
const USER_HASH = 'bd94dcda26fccb4e68d6a31f9b5aac0b571ae266d822620e901ef7ebe3a11d4f'

export const DEMO_USERS: User[] = [
  {
    id: 'admin-demo', username: 'admin', passwordHash: ADMIN_HASH, role: 'admin', approvalStatus: 'approved',
    pricePerShot: 0, active: true, requestedAt: '2026-07-01T00:00:00.000Z', approvedAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'agency-demo', username: 'agency1', passwordHash: USER_HASH, role: 'agency', approvalStatus: 'approved',
    pricePerShot: 100, active: true, requestedAt: '2026-07-10T02:10:00.000Z', approvedAt: '2026-07-10T04:00:00.000Z', updatedAt: '2026-07-10T04:00:00.000Z',
  },
  {
    id: 'distributor-demo', username: 'dist1', passwordHash: USER_HASH, role: 'distributor', approvalStatus: 'approved',
    pricePerShot: 80, active: true, requestedAt: '2026-07-12T01:30:00.000Z', approvedAt: '2026-07-12T05:20:00.000Z', updatedAt: '2026-07-12T05:20:00.000Z',
  },
  {
    id: 'pending-demo', username: 'newagency', passwordHash: USER_HASH, role: null, approvalStatus: 'pending',
    pricePerShot: 0, active: false, requestedAt: new Date().toISOString(), approvedAt: null, updatedAt: new Date().toISOString(),
  },
]

function orderBase(
  partial: Pick<Order, 'id' | 'createdBy' | 'creatorUsername' | 'placeUrl' | 'mid' | 'storeName' | 'keyword' | 'dailyShots' | 'operationDays' | 'pricePerShot' | 'startDate' | 'endDate' | 'status'>,
): Order {
  const amount = calculateAmount(partial.dailyShots, partial.operationDays, partial.pricePerShot)
  const createdAt = new Date(Date.now() - 86_400_000).toISOString()
  return {
    ...partial,
    createdAt,
    ...amount,
    memo: '',
    activatedAt: partial.status === '구동중' ? new Date(`${partial.startDate}T09:00:00+09:00`).toISOString() : null,
    stoppedAt: partial.status === '정지' ? new Date().toISOString() : null,
    paymentNotifiedAt: partial.status === '입금대기' ? null : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function makeDemoOrders(): Order[] {
  const today = todayInSeoul()
  return [
    orderBase({
      id: `SP-${today.replaceAll('-', '')}-0001`, createdBy: 'agency-demo', creatorUsername: 'agency1',
      placeUrl: 'https://m.place.naver.com/place/1250872931/home', mid: '1250872931', storeName: '로나파티', keyword: '셀프촬영풍선',
      dailyShots: 100, operationDays: 30, pricePerShot: 100, startDate: addDays(today, -1), endDate: addDays(today, 28), status: '구동중',
    }),
    orderBase({
      id: `SP-${today.replaceAll('-', '')}-0002`, createdBy: 'agency-demo', creatorUsername: 'agency1',
      placeUrl: 'https://m.place.naver.com/place/9876543210/home', mid: '9876543210', storeName: '그린팜', keyword: '유기농야채배송',
      dailyShots: 300, operationDays: 20, pricePerShot: 100, startDate: today, endDate: addDays(today, 19), status: '구동중',
    }),
    orderBase({
      id: `SP-${today.replaceAll('-', '')}-0003`, createdBy: 'distributor-demo', creatorUsername: 'dist1',
      placeUrl: 'https://m.place.naver.com/place/1122334455/home', mid: '1122334455', storeName: '핸드메이드샵', keyword: '케이크토퍼주문',
      dailyShots: 150, operationDays: 14, pricePerShot: 80, startDate: addDays(today, 1), endDate: addDays(today, 14), status: '입금완료',
    }),
    orderBase({
      id: `SP-${today.replaceAll('-', '')}-0004`, createdBy: 'agency-demo', creatorUsername: 'agency1',
      placeUrl: 'https://m.place.naver.com/place/5566778899/home', mid: '5566778899', storeName: '스타일샵', keyword: '여름린넨원피스',
      dailyShots: 75, operationDays: 7, pricePerShot: 100, startDate: addDays(today, 1), endDate: addDays(today, 7), status: '입금대기',
    }),
    orderBase({
      id: `SP-${today.replaceAll('-', '')}-0005`, createdBy: 'distributor-demo', creatorUsername: 'dist1',
      placeUrl: 'https://m.place.naver.com/place/2211334477/home', mid: '2211334477', storeName: '펫샵', keyword: '반려견관절영양제',
      dailyShots: 200, operationDays: 10, pricePerShot: 80, startDate: addDays(today, -3), endDate: addDays(today, 6), status: '정지',
    }),
  ]
}

export const DEMO_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notification-pending', createdAt: new Date().toISOString(), userId: 'admin-demo', role: 'admin',
    title: '회원가입 승인 요청', message: 'newagency 회원의 가입 승인이 필요합니다.', read: false,
  },
  {
    id: 'notification-payment', createdAt: new Date(Date.now() - 3_600_000).toISOString(), userId: 'agency-demo', role: 'agency',
    title: '입금 확인 완료', message: '작업의 입금이 확인되었습니다.', read: false,
  },
]

export const DEMO_NOTICES: Notice[] = [
  {
    id: 'notice-1', title: '금일 오후 6시 전 접수건까지 익일 구동됩니다.',
    content: '오후 6시 이후 접수된 작업은 이틀 뒤 오전 9시에 시작됩니다. 입금완료 상태인 작업만 자동 시작됩니다.',
    pinned: true, createdAt: '2026-07-29T01:00:00.000Z',
  },
  {
    id: 'notice-2', title: '작업 접수 URL과 키워드를 다시 확인해 주세요.',
    content: '접수 완료 후 URL 및 키워드 변경은 관리자에게 요청해 주세요.',
    pinned: false, createdAt: '2026-07-20T01:00:00.000Z',
  },
]

export const DEFAULT_SETTINGS: AppSettings = {
  cutoffHour: 18,
  autoStartHour: 9,
  bank: '국민은행',
  accountNumber: '123456-01-123456',
  accountHolder: '주식회사 스파크',
}
