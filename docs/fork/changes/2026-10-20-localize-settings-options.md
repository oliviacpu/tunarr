# Localized settings options (D5)

The existing stream mode, watermark position, error screen, and error audio choices now pass through Lingui. The seven feature flags use typed web message descriptors for their names and descriptions. English wording and stored values are unchanged; the shared flag metadata and API contracts remain unchanged.

Each filler-list delete button now has a localized accessible name identifying its list. Existing delete confirmation and cancellation behavior is unchanged.

Design: D5 leftovers in the approved UI audit, approved in fork PR #85. Translation catalogs are regenerated after integration.
