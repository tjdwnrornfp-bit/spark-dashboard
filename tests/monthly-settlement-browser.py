import json,os,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path(os.environ.get('MONTHLY_UI_DIR','.test-output/monthly-ui'))
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':1100});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 for attempt in range(40):
  try: page.goto('http://127.0.0.1:4176');break
  except Exception:
   if attempt==39:raise
   time.sleep(.25)
 page.get_by_role('button',name='월별 현황',exact=True).click()
 page.get_by_label('조회 월',exact=True).fill('2001-09')
 expect(page.locator('.monthly-cards')).to_contain_text('70,000원')
 expect(page.locator('.monthly-cards')).to_contain_text('35,000원')
 expect(page.get_by_role('button',name='푸른마케팅 agencyA')).to_be_visible()
 page.screenshot(path=str(out/'monthly-desktop.png'),full_page=True)
 page.get_by_role('button',name='푸른마케팅 agencyA').click();dialog=page.get_by_role('dialog')
 expect(dialog.locator('.monthly-detail-list article')).to_have_count(50)
 dialog.get_by_role('button',name='다음',exact=True).click();expect(dialog.locator('.monthly-detail-list article')).to_have_count(10)
 dialog.get_by_role('button',name='닫기',exact=True).last.click()
 with page.expect_download() as downloaded:page.get_by_role('button',name='엑셀 저장',exact=True).click()
 downloaded.value.save_as(str(out/'monthly-export.xlsx'))
 page.get_by_label('업체·작업 검색').fill('오렌지');expect(page.locator('.monthly-cards')).to_contain_text('10,000원')
 expect(page.get_by_role('button',name='푸른마케팅 agencyA')).to_have_count(0)
 page.get_by_role('button',name='월마감 저장',exact=True).click();dialog=page.get_by_role('dialog')
 expect(dialog).to_contain_text('70,000원') # Closing always saves the full month, never the searched subset.
 dialog.get_by_label('마감 사유').fill('9월 정산 검토 완료');page.evaluate('window.loseSaveResponse=true')
 dialog.get_by_role('button',name='마감본 저장',exact=True).click()
 expect(dialog.get_by_role('alert')).to_contain_text('연결이 끊어졌습니다')
 dialog.get_by_role('button',name='같은 요청으로 결과 다시 확인',exact=True).click()
 expect(page.locator('.monthly-success')).to_contain_text('마감 1차')
 requests=page.evaluate("window.calls.filter(c=>c.name==='save_admin_monthly_settlement_v1016').map(c=>c.args)")
 assert requests[0]==requests[1]
 expect(page.get_by_label('조회 자료')).not_to_have_value('')
 page.get_by_role('button',name='초기화',exact=True).click();expect(page.locator('.monthly-cards')).to_contain_text('70,000원')
 page.screenshot(path=str(out/'monthly-closed.png'),full_page=True)
 page.get_by_label('조회 자료').select_option('')
 page.get_by_role('button',name='월별 입금 내역',exact=True).click();expect(page.locator('.monthly-cards')).to_contain_text('0원')
 page.get_by_label('조회 월',exact=True).fill('2001-10');expect(page.locator('.monthly-cards')).to_contain_text('35,000원')
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(out/'monthly-mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
 page.get_by_role('button',name='푸른마케팅 agencyA').click();expect(page.get_by_role('dialog')).to_be_visible()
 expect(page.get_by_role('dialog').locator('.monthly-detail-list article')).to_have_count(35)
 page.screenshot(path=str(out/'monthly-detail-mobile.png'))
 assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
 assert not errors,errors
 browser.close()
out.joinpath('result.json').write_text(json.dumps({'passed':True,'checks':['actual UI HTTP DB flow','month selection','summary and filtered totals','50 row detail pagination','XLSX download','full-month close under search','lost-response identical retry','saved snapshot display','start vs confirmation month','mobile overflow'],'pageErrors':errors},ensure_ascii=False),encoding='utf-8')
print('PASS monthly desktop/mobile: actual HTTP-to-database flow, filters, details, export, close, retry, month basis')
