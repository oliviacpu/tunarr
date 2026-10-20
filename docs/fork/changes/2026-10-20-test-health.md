### UI audit tests wait for their actual asynchronous work (2026-10-20)

- **What you saw:** the audit recorded cold-render timeouts, a pruning-floor test that depended on a 50ms sleep, and colliding browser fixture ports across worktrees.
- **Cause:** first-render assertions used the default one-second wait, segment deletion was fire-and-forget, and every fixture hard-coded the same ports.
- **Fix:** T1. Give the two asynchronous form mounts explicit five-second waits; await the actual pruning result and save completion; replace an inline import type with a top-level type import. Keep the existing 15-second test limit and two-worker guidance for expensive language-picker tests. Browser runs accept a validated `TUNARR_E2E_PORT_OFFSET` for isolated parallel worktrees.
- **Tests:** affected component and HLS suites, default/offset/invalid-port regression tests, and browser fixture startup with an offset.
- **Upstream:** not sent.
