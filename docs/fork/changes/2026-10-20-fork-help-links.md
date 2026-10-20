### Help links describe the running fork (2026-10-20)

- **What you saw:** in-app help opened upstream documentation, and the error page prepared an upstream bug report even for fork behavior.
- **Cause:** links hard-coded upstream destinations.
- **Fix:** approved D5/D7 follow-ups. Link help and Search syntax to the fork's checked-in documentation, since this fork has no published documentation site. Prepare bug reports in the fork repository while retaining the existing environment and error fields.
- **Tests:** every documentation destination resolves to a checked-in Markdown file and heading; the error page link targets the fork and keeps its prefilled fields.
- **Upstream:** not sent.
