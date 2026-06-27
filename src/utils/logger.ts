const ts = () => new Date().toISOString()

export const log = {
  info  : (...a: unknown[]) => console.log( `[${ts()}] ℹ️  `, ...a),
  ok    : (...a: unknown[]) => console.log( `[${ts()}] ✅  `, ...a),
  warn  : (...a: unknown[]) => console.warn(`[${ts()}] ⚠️  `, ...a),
  error : (...a: unknown[]) => console.error(`[${ts()}] ❌  `, ...a),
  skip  : (...a: unknown[]) => console.log( `[${ts()}] ⏭️  `, ...a),
  tx    : (...a: unknown[]) => console.log( `[${ts()}] 💸  `, ...a),
  event : (...a: unknown[]) => console.log( `[${ts()}] 📡  `, ...a),
}
