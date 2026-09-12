/** Explicit acceptance checks: missing observations must never count as passes. */
export function createQaChecks(required: readonly string[]) {
  const observations = new Map<string, boolean>()
  return {
    record(name: string, passed: boolean) {
      // A later successful retry must not erase an earlier failed observation.
      observations.set(name, observations.get(name) !== false && passed === true)
    },
    result() {
      const failed = required.filter(name => observations.get(name) === false)
      const missing = required.filter(name => !observations.has(name))
      return { passed: failed.length === 0 && missing.length === 0, failed, missing }
    }
  }
}
