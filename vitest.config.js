/** @type {import('vitest/config').UserConfig} */
module.exports = {
  // Prevent Vite/Vitest from trying to read ignored `.env` files in this repo.
  // (Cursor sandbox blocks access to ignored files; CI also won't have them.)
  envDir: "./test/env",
  test: {
    include: ["test/**/*.test.mjs"],
    environment: "node",
    restoreMocks: true,
    clearMocks: true,
    // Keep the suite deterministic and lightweight in local worktrees and CI.
    maxWorkers: 1,
  },
};
