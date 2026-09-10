export const ROW_INTERACTIVE = 'input,button,a,select,textarea,label,[data-no-row-select],[role="button"],[role="link"],[role="checkbox"],[contenteditable="true"]'

export function isRowInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(ROW_INTERACTIVE))
}

export function selectRowRange(current: ReadonlySet<string>, visible: readonly string[], anchor: string | null, clicked: string, shift: boolean): Set<string> {
  const next = new Set(current)
  const end = visible.indexOf(clicked), start = anchor === null ? -1 : visible.indexOf(anchor)
  if (end < 0) return next
  if (shift && start >= 0) {
    visible.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((id) => next.add(id))
  } else if (next.has(clicked)) next.delete(clicked)
  else next.add(clicked)
  return next
}
