/**
 * Shared clock tick for relative-time displays.
 *
 * Memoized list rows (e.g. SessionItem) no longer re-render on unrelated
 * state changes, so relative timestamps ("5 minutes ago") would freeze
 * without an explicit refresh signal. Subscribing to minuteTickAtom
 * re-renders the consumer once per minute. The interval only runs while at
 * least one subscriber is mounted (jotai onMount/onUnmount lifecycle).
 */

import { atom } from 'jotai'

export const minuteTickAtom = atom(0)
minuteTickAtom.onMount = (setAtom) => {
  const id = setInterval(() => setAtom((tick) => tick + 1), 60_000)
  return () => clearInterval(id)
}
