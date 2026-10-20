# Lineup and calendar theme colours

The lineup list, mid-roll group headers and day/week calendar previews now reuse
the guide's existing eight-step theme ramp. Episodes and custom-show entries
follow their show or artist grouping; movies and other videos follow their
program. Flex gaps and redirects retain their distinct semantic treatment, and
the resolved light/dark scheme supplies fills, text, hover colours and dividers.
Scheduling, grouping, titles and controls are unchanged.

Lineup times/counts, calendar dates/times and the guide's remaining-time text use
tabular numerals. The existing palette, including its dark yellow step, is
unchanged.

Validation: focused theme/category and rendered component regressions, web
typechecking, changed-file lint and quick preflight; browser captures cover
390px/1440px in both schemes with the existing seeded fixture. The browser test
intercepts GET responses for a longer mixed/mid-roll lineup; it does not save
fixture programming or change scheduling behavior.
