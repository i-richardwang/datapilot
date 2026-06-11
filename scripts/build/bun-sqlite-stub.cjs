// Stub for bun:sqlite when bundling the server for Node.
// The Node runtime path registers better-sqlite3 instead (see db/driver.ts);
// the bun driver branch is never taken, so this is never constructed.
module.exports = {};
