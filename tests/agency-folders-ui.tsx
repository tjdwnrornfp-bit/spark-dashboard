// Synthetic, local-only browser fixture; never connects to a production database.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ManagedOrdersPage } from '../src/features/ManagedOrdersPage'
import { DEMO_USERS } from '../src/data/demo'
import '../src/styles.css'
const user = { ...DEMO_USERS[0], id: 'manager-fixture', isOperationsManager: true }
const members = DEMO_USERS.slice(1, 4).map(m => ({ ...m, managerId: user.id }))
const orders = Array.from({ length: 62 }, (_, i) => ({
  id: `fixture-${i}`, dbId: `fixture-${i}`, createdBy: members[i < 55 ? 0 : i < 60 ? 1 : 2].id,
  creatorUsername: members[i < 55 ? 0 : i < 60 ? 1 : 2].username, programType: 'spark',
  storeName: `테스트 상호 ${i}`, keyword: '대표키워드', mid: `12345${i}`, placeUrl: '',
  dailyShots: 100, operationDays: 30, pricePerShot: 20, supplyAmount: 60000, vatAmount: 6000, totalAmount: 66000,
  startDate: '2026-09-15', endDate: '2026-10-14', status: ['입금대기', '입금완료', '구동중', '정지', '만료'][i % 5],
  createdAt: `2026-09-14T00:${String(i % 60).padStart(2,'0')}:00Z`, archivedAt: null,
})) as Parameters<typeof ManagedOrdersPage>[0]['orders']
const steps: Parameters<typeof ManagedOrdersPage>[0]['paymentSteps'] = []
function Fixture() {
  const [revision, setRevision] = useState(0)
  const [preset, setPreset] = useState(false)
  return <main style={{ padding: 24 }}><div><button onClick={() => setRevision(v => v + 1)}>Realtime 변경 모의</button><button onClick={() => setPreset(v => !v)}>Dashboard 대행사 preset 모의</button></div><ManagedOrdersPage key={String(preset)} user={user} members={members} orders={orders} paymentSteps={steps} serverMode={false} refreshKey={revision} initialFilters={preset ? {agencyId: members[1].id, settlementStatus: '정산대기'} : null} /></main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
