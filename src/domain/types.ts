export type Role = 'admin' | 'agency' | 'distributor'
export type MemberRole = 'agency' | 'distributor' | 'manager'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type OrderStatus = '입금대기' | '입금완료' | '구동중' | '정지' | '만료'
export type ProgramType = 'spark' | 'spark_plus' | 'spark_s' | 'spark_s_plus'
export type ProgramTransferState = 'none' | 'payment_pending'
export type Page = 'dashboard' | 'notifications' | 'managedOrders' | 'sparkOrders' | 'sparkPlusOrders' | 'sparkSOrders' | 'sparkSPlusOrders' | 'settlement' | 'members' | 'operations' | 'myinfo' | 'notices'

export interface ProgramPriceMap {
  spark: number
  spark_plus: number
  spark_s: number
  spark_s_plus: number
}

export interface User {
  id: string
  username: string
  phoneNumber: string
  passwordHash?: string
  role: Role | null
  approvalStatus: ApprovalStatus
  pricePerShot: number
  sparkPricePerShot: number
  sparkPlusPricePerShot: number
  sparkSPricePerShot: number
  sparkSPlusPricePerShot: number
  active: boolean
  requestedAt: string
  approvedAt: string | null
  updatedAt: string
  sponsorId: string | null
  sponsorUsername: string | null
  isOperationsManager: boolean
  managerId: string | null
  managerUsername: string | null
  referralCode: string
  groupName: string
  hierarchyDepth: number
  bank: string
  accountNumber: string
  accountHolder: string
}

export interface SignupDraft {
  username: string
  phoneNumber: string
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
  /** Historical snapshot captured when the order was created. */
  creatorGroupName: string
  /** Current profile group, populated separately for display. Empty is meaningful. */
  currentCreatorGroupName?: string
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
  programTransferState: ProgramTransferState
  programTransferDifference: number
  lastProgramTransferAt: string | null
  settlementReversalPending: boolean
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
  programType: ProgramType
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
  canConfirm: boolean
  previousPendingCount: number
  createdAt: string
}

export type ManagedOrderSettlementStatus = '정산대기' | '부분완료' | '정산완료'

export interface ManagedOrderFilters {
  agencyId: string
  programType: ProgramType | 'all'
  orderStatus: OrderStatus | 'all' | 'in_progress'
  sort: 'priority' | 'newest' | 'oldest' | 'start_date'
  settlementStatus: ManagedOrderSettlementStatus | 'all'
  query: string
  startDateFrom: string
  startDateTo: string
}

export interface ManagedOrderRow {
  orderId: string
  orderNumber: string
  registrantId: string
  registrantUsername: string
  programType: ProgramType
  storeName: string
  keyword: string
  mid: string
  placeUrl: string
  dailyShots: number
  operationDays: number
  pricePerShot: number
  supplyAmount: number
  vatAmount: number
  totalAmount: number
  startDate: string
  endDate: string
  orderStatus: OrderStatus
  settlementStatus: ManagedOrderSettlementStatus
  settlementDetail: string
  confirmedSteps: number
  totalSteps: number
  programTransferState: ProgramTransferState
  settlementReversalPending: boolean
  createdAt: string
}

export interface ManagedOrdersPageResult {
  rows: ManagedOrderRow[]
  page: number
  pageSize: number
  totalPages: number
  totalCount: number
}

export interface ManagedOrderFilterOption {
  id: string
  username: string
}

export interface ManagedOrdersSummary {
  managedAgencyCount: number
  totalOrderCount: number
  runningOrderCount: number
  settlementWaitingCount: number
  totalAmount: number
  settlementWaitingAmount: number
}

export interface ManagerDashboardSummary {
  managedAgencyCount: number
  totalOrderCount: number
  totalSettlementAmount: number
  settlementWaitingAmount: number
  settlementCompletedAmount: number
  runningOrderCount: number
  paymentWaitingOrderCount: number
  paymentCompletedOrderCount: number
  expiredOrderCount: number
  stoppedOrderCount: number
}

export type ManagerAgencyOverviewSort = 'settlement_waiting' | 'orders' | 'running' | 'username'

export interface ManagerAgencyOverviewItem {
  agencyId: string
  username: string
  totalOrderCount: number
  runningOrderCount: number
  paymentWaitingOrderCount: number
  paymentCompletedOrderCount: number
  expiredOrderCount: number
  stoppedOrderCount: number
  totalSettlementAmount: number
  settlementWaitingAmount: number
  settlementCompletedAmount: number
  lastOrderAt: string
}

export interface ManagerAgencyOverviewResult {
  page: number
  pageSize: number
  totalPages: number
  agencyCount: number
  agencies: ManagerAgencyOverviewItem[]
}

export interface ManagedOrdersPreset {
  agencyId?: string
  settlementStatus?: ManagedOrderSettlementStatus
}

export interface ProgramTransferPreview {
  orderDbId: string
  orderNumber: string
  currentStatus: OrderStatus
  afterStatus: OrderStatus
  beforeProgram: ProgramType
  afterProgram: ProgramType
  beforeUnitPrice: number
  afterUnitPrice: number
  beforeSupplyAmount: number
  afterSupplyAmount: number
  beforeVatAmount: number
  afterVatAmount: number
  beforeTotalAmount: number
  afterTotalAmount: number
  difference: number
  confirmedPaymentCount: number
  pendingPaymentCount: number
  settlementMode: 'rebuild' | 'adjustment'
  settlementImpact: string
  keepsOperationRunning: boolean
  expectedVersion: number
  canTransfer: boolean
  blockedReason: string
}

export type BulkProgramTransferItemStatus = 'ready' | 'excluded' | 'blocked'

export interface BulkProgramTransferPreviewItem {
  orderDbId: string
  orderNumber: string
  storeName: string
  beforeProgram: ProgramType
  status: BulkProgramTransferItemStatus
  difference: number
  expectedVersion: number
  blockedReason: string
  preview: ProgramTransferPreview | null
}

export interface BulkProgramTransferPreview {
  selectedCount: number
  readyCount: number
  excludedCount: number
  blockedCount: number
  programCounts: Record<ProgramType, number>
  targetProgram: ProgramType
  expectedAdditionalAmount: number
  expectedDeductionAmount: number
  expectedDifference: number
  items: BulkProgramTransferPreviewItem[]
}

export type BulkProgramTransferResultStatus = 'succeeded' | 'failed' | 'excluded'

export interface BulkProgramTransferResultItem {
  orderDbId: string
  orderNumber: string
  storeName: string
  status: BulkProgramTransferResultStatus
  message: string
  order: Order | null
  transfer: ProgramTransferPreview | null
}

export interface BulkProgramTransferResult {
  selectedCount: number
  succeededCount: number
  failedCount: number
  excludedCount: number
  targetProgram: ProgramType
  items: BulkProgramTransferResultItem[]
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


export interface MemberDeletionCheck {
  memberId: string
  username: string
  canDelete: boolean
  isAdminAccount: boolean
  isCurrentUser: boolean
  orderCount: number
  sponsoredOrderCount: number
  paymentStepCount: number
  childCount: number
  noticeCount: number
  settlementQuoteCount: number
  settlementBatchCount: number
  reasons: string[]
}

export interface MemberDeletionResult {
  ok: boolean
  memberId: string
  username: string
  deletedAt: string
}

export type MemberManagerAssignmentItemStatus = 'succeeded' | 'failed'

export interface MemberManagerAssignmentResultItem {
  memberId: string
  username: string
  status: MemberManagerAssignmentItemStatus
  message: string
  member: User | null
}

export interface MemberManagerBulkAssignmentResult {
  selectedCount: number
  succeededCount: number
  failedCount: number
  managerId: string | null
  managerUsername: string | null
  items: MemberManagerAssignmentResultItem[]
}

export interface MemberPasswordResetResult {
  ok: boolean
  memberId: string
  username: string
  resetAt: string
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

export type SettlementListStatus = 'waiting' | 'confirmed' | 'all'
export type SettlementSelectionMode = 'explicit' | 'filtered'

export interface SettlementFilters {
  payerId: string
  registrantId: string
  groupName: string
  query: string
  programType: ProgramType | 'all'
  status: SettlementListStatus
  startDateFrom: string
  startDateTo: string
}

export interface SettlementRow extends PaymentStep {
  mid: string
  registrantId: string
  registrantUsername: string
  registrantGroupName: string
  startDate: string
  orderStatus: OrderStatus
  orderLockVersion: number
  settlementReversalPending: boolean
  registrantItemCount: number
  registrantTotalAmount: number
  registrantReadyCount: number
  registrantReadyAmount: number
  registrantSparkCount: number
  registrantSparkAmount: number
  registrantSparkPlusCount: number
  registrantSparkPlusAmount: number
  registrantSparkSCount: number
  registrantSparkSAmount: number
  registrantSparkSPlusCount: number
  registrantSparkSPlusAmount: number
}

export interface PaymentReversalResult {
  paymentStepId: string
  orderId: string
  orderStatus: OrderStatus
  orderLockVersion: number
  operationStatusPreserved: boolean
  restoredToWaiting: boolean
  settlementReversalPending: boolean
  reversedAt: string
}

export interface SettlementPageResult {
  rows: SettlementRow[]
  page: number
  pageSize: number
  totalPages: number
  totalCount: number
  totalAmount: number
  readyCount: number
  readyAmount: number
}

export interface SettlementSummary {
  waitingCount: number
  waitingAmount: number
  confirmedCount: number
  confirmedAmount: number
  totalCount: number
  totalAmount: number
  receivedCount: number
  receivedAmount: number
}

export interface SettlementFilterOption {
  id: string
  label: string
}

export interface SettlementFilterOptions {
  payers: SettlementFilterOption[]
  registrants: SettlementFilterOption[]
  groups: string[]
}

export interface SettlementQuoteGroup {
  payerId: string
  payerUsername: string
  itemCount: number
  expectedAmount: number
}

export interface SettlementQuote {
  id: string
  itemCount: number
  expectedAmount: number
  expiresAt: string
  groups: SettlementQuoteGroup[]
}

export interface SettlementConfirmationInput {
  payerId: string
  actualAmount: number
  depositorName: string
}

export interface SettlementBatchResultItem {
  id: string
  batchNumber: string
  payerId: string
  payerUsername: string
  itemCount: number
  expectedAmount: number
  actualAmount: number
  confirmedAt: string
}

export interface SettlementBatchResult {
  itemCount: number
  totalAmount: number
  batches: SettlementBatchResultItem[]
}

export interface SettlementBatchHistoryItem extends SettlementBatchResultItem {
  payeeId: string
  payeeUsername: string
  depositorName: string
  memo: string
  status: 'confirmed' | 'voided'
}


export type CompanyOverviewSort = 'pending_amount' | 'daily_shots' | 'orders' | 'recent'

export interface AdminCompanyOverviewItem {
  registrantId: string
  username: string
  groupName: string
  totalOrders: number
  waitingOrderCount: number
  waitingAmount: number
  confirmedOrderCount: number
  confirmedAmount: number
  expiredCount: number
  runningCount: number
  dailyRunningShots: number
  sparkSRunningUnits: number
  sparkSPlusRunningUnits: number
  sparkCount: number
  sparkPlusCount: number
  sparkSCount: number
  sparkSPlusCount: number
  lastOrderAt: string
}

export interface AdminCompanyOverviewResult {
  page: number
  pageSize: number
  totalPages: number
  companyCount: number
  totalOrders: number
  waitingAmount: number
  confirmedAmount: number
  expiredCount: number
  dailyRunningShots: number
  sparkSRunningUnits: number
  sparkSPlusRunningUnits: number
  companies: AdminCompanyOverviewItem[]
}

export interface SettlementBatchItemDetail {
  paymentStepId: string
  orderId: string
  orderNumber: string
  storeName: string
  registrantId: string
  registrantUsername: string
  registrantGroupName: string
  programType: ProgramType
  amount: number
}
