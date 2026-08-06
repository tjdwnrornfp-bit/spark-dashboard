export type Role = 'admin' | 'agency' | 'distributor'
export type MemberRole = Exclude<Role, 'admin'>
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type OrderStatus = '입금대기' | '입금완료' | '구동중' | '정지' | '만료'
export type ProgramType = 'spark' | 'spark_plus' | 'spark_s'
export type Page = 'dashboard' | 'notifications' | 'sparkOrders' | 'sparkPlusOrders' | 'sparkSOrders' | 'settlement' | 'members' | 'operations' | 'myinfo' | 'notices'

export interface ProgramPriceMap {
  spark: number
  spark_plus: number
  spark_s: number
}

export interface User {
  id: string
  username: string
  passwordHash?: string
  role: Role | null
  approvalStatus: ApprovalStatus
  pricePerShot: number
  sparkPricePerShot: number
  sparkPlusPricePerShot: number
  sparkSPricePerShot: number
  active: boolean
  requestedAt: string
  approvedAt: string | null
  updatedAt: string
  sponsorId: string | null
  sponsorUsername: string | null
  referralCode: string
  groupName: string
  hierarchyDepth: number
  bank: string
  accountNumber: string
  accountHolder: string
}

export interface SignupDraft {
  username: string
  password: string
  passwordConfirm: string
  referralCode: string
}

export interface Order {
  id: string
  dbId?: string
  createdAt: string
  createdBy: string
  creatorUsername: string
  sponsorId: string | null
  sponsorUsername: string | null
  creatorGroupName: string
  programType: ProgramType
  placeUrl: string
  mid: string
  storeName: string
  keyword: string
  dailyShots: number
  operationDays: number
  pricePerShot: number
  supplyAmount: number
  vatAmount: number
  totalAmount: number
  startDate: string
  endDate: string
  status: OrderStatus
  memo: string
  activatedAt: string | null
  stoppedAt: string | null
  paymentNotifiedAt: string | null
  archivedAt: string | null
  archivedBy: string | null
  archiveReason: string
  lockVersion: number
  updatedAt: string
}

export interface OrderDraft {
  programType: ProgramType
  placeUrl: string
  storeName: string
  keyword: string
  dailyShots: string
  operationDays: string
  startDate: string
  memo: string
}

export interface PaymentStep {
  id: string
  orderDbId: string
  orderNumber: string
  storeName: string
  stepOrder: number
  payerId: string
  payerUsername: string
  payeeId: string
  payeeUsername: string
  unitPrice: number
  supplyAmount: number
  vatAmount: number
  totalAmount: number
  confirmedAt: string | null
  createdAt: string
}

export interface PaymentAccount {
  payeeId: string | null
  payeeUsername: string
  bank: string
  accountNumber: string
  accountHolder: string
  source: 'admin' | 'sponsor'
}

export interface NotificationItem {
  id: string
  createdAt: string
  userId: string | null
  role: Role | 'all'
  title: string
  message: string
  read: boolean
  orderId?: string
}

export interface Notice {
  id: string
  title: string
  content: string
  pinned: boolean
  createdAt: string
}

export interface AppSettings {
  cutoffHour: number
  autoStartHour: number
  bank: string
  accountNumber: string
  accountHolder: string
}

export interface MemberReviewInput {
  member: User
  role: MemberRole
  prices: ProgramPriceMap
  approvalStatus: 'approved' | 'rejected'
  groupName: string
}

export interface AccountDraft {
  bank: string
  accountNumber: string
  accountHolder: string
}

export interface AuditLog {
  id: string
  createdAt: string
  actorId: string | null
  actorUsername: string
  actorRole: Role | null
  action: string
  entityType: 'order' | 'member' | 'payment' | 'system'
  entityId: string | null
  entityLabel: string
  metadata: Record<string, unknown>
}

export interface OperationsHealth {
  schemaVersion: string
  activeAdmins: number
  activeOrders: number
  archivedOrders: number
  ordersWithoutPaymentSteps: number
  invalidPaymentStates: number
  inactiveCronJobs: number
  checkedAt: string
}
