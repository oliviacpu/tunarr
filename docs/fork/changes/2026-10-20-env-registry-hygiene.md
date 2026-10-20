### Environment overrides and settings CLI (2026-10-20, PR #117)

**What you saw:** Some environment overrides were undocumented or read outside the central registry. Logging examples used the wrong variable, edge builds looked for a misspelled commit variable, and the settings CLI could update only the nested settings section. Status did not explain environment overrides.

**Cause:** Environment reads, build metadata, documentation, and CLI settings validation had drifted apart.

**Fix:** Centralize runtime environment reads, document every registry entry and per-class logger overrides, remove the unused program-group chunk variable, and support `TUNARR_BUILD_SHA` while retaining the existing `TUNARR_BUILD` build input. Parse inlined booleans from the same resolved value as other reads. The CLI now validates and updates `system` and `featureFlags` along with existing nested settings; it preserves internal settings-file state. Status displays a read-only, explicitly selected set of safe parsed overrides through the existing environment endpoint; credentials, paths, and platform/build metadata are omitted.

**Tests:** Registry/documentation and direct-read checks, build-inlined boolean precedence, safe override parsing/filtering, CLI updates and atomic validation, existing environment-sensitive server tests, typechecking, lint, and builds. Final check results are in the PR.

**Upstream:** No upstream issue; approved fork UI/settings audit S7 (PR #85).
