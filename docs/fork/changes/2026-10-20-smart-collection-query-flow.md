### Smart Collection create and query editing (2026-10-20)

- **What you saw:** Create opened Search without explaining the next step, and Edit only changed a collection's name.
- **Cause:** the search route had no collection-creation context, and the edit dialog omitted the stored query.
- **Fix:** Create opens Search with a short instruction and a visible Save as collection button, then returns to the list after saving. Edit loads and saves the name, keywords, and filter using the existing text and visual query builders. Clearing a filter uses the existing API's empty expression representation. Invalid filters cannot save, Cancel preserves the query, and background refetches preserve unsaved edits.
- **Tests:** editor unit tests cover parsing, clearing, and preserving dirty input; browser tests cover create, edit, both builders, persistence after reload, clearing, navigation, invalid input, Cancel, and 390/1440 px light/dark layouts. Web/e2e typechecks, changed-file lint, and production bundle pass.
- **Upstream:** not sent.
