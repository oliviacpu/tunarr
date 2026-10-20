### Inputs use readable mobile sizing (2026-10-20)

- **What you saw:** phones rendered form inputs at 14px, which can trigger Safari focus zoom, with floating labels scaled from that small base.
- **Cause:** inputs and picker fields inherited the desktop body type size at every viewport width.
- **Fix:** approved UI follow-up D8. The theme sets input text, input labels and MUI X picker input bases to 16px below the `sm` breakpoint and 14px from `sm` up. The viewport's zoom policy is unchanged. Guide refresh fields also stack with an explicit phone layout and flex gap so the next floating label clears the preceding help text (D2/C2 follow-up).
- **Tests:** browser coverage checks text fields, selects, labels and date/time picker bases at 390px and 1440px in both colour schemes, including page overflow and screenshots.
- **Upstream:** not sent.
