### Fork images identify their release commit (2026-10-20)

- **What you saw:** the released image's OCI revision label identified the base image's commit instead of the Tunarr release commit.
- **Cause:** the fork image workflow set source and version labels but inherited the base image's revision label.
- **Fix:** explicitly set `org.opencontainers.image.revision` to the workflow's full release commit SHA. Image tags, newest-release promotion to `latest`, version strings and GitHub release behavior stay unchanged. Existing images are unchanged; the correction applies to future builds.
- **Tests:** a focused parsed-workflow assertion fails on the original workflow and passes with the revision label. Removing that single label produces the original parsed workflow exactly; formatting and changed-file lint checks pass. No release, image build or deployment was run.
- **Upstream:** not sent; fork-only workflow correction.
