### Channel edit tabs have addresses (2026-10-20)

- **What you saw:** channel tabs shared an edit URL with a query parameter, browser history did not step through tabs, and Streaming also held watermark controls.
- **Cause:** one page kept its active tab in local state and replaced the query string when it changed.
- **Fix:** Properties, Flex, Guide, Streaming, and Watermark are child routes under one persistent edit form. Tabs and browser history preserve the form's unsaved values. Watermark controls retain their existing behavior in their own tab. Legacy `?tab=epg` and `?tab=ffmpeg` links redirect to Guide and Streaming. The guard exempts literal tab paths only for the current channel; leaving the editor or changing channel still asks first.
- **Tests:** real-router unit tests cover tab history, one save across tabs, field error mapping, all five navigation matches, legacy tab mapping, and scoped guard exemptions. Browser tests cover deep links, redirects, history, persistence, Cancel/Proceed, and both themes at 390/1440 px, plus existing subtitle editing regressions.
- **Upstream:** not sent.
