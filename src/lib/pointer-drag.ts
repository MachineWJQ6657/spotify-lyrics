type DragRef = { current: { pointerId: number; active: boolean } | null }

/** Clear ownership before IPC so pointerup/lostcapture cannot finish twice. */
export function finishPointerDrag(ref: DragRef, endMove: () => void, pointerId?: number) {
  const drag = ref.current
  if (!drag || (pointerId != null && drag.pointerId !== pointerId)) return false
  ref.current = null
  if (drag.active) endMove()
  return true
}
