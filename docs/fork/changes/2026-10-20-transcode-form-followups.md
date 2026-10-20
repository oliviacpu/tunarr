### Transcode form phone layout and validation follow-ups (2026-10-20)

- **What you saw:** some transcode fields had no phone grid width, the heading and advanced control crowded each other, and invalid numeric text exposed Zod's raw NaN message. Documentation also described a VAAPI driver selector absent from the form.
- **Cause:** responsive layout declarations began at `sm`; the resolver used its default error text; documentation described a stored setting as an exposed control.
- **Fix:** C4 follow-ups. Stack related controls and give grid fields full width on phones, present a translated numeric validation message, correct the driver documentation, and remove the unused React devtools dependency. The pending-save Reset safeguard is covered by C3.
- **Tests:** invalid bitrate and thread inputs retain Save blocking and now show the readable error; transcode form/video regression suites and phone/desktop browser layout checks.
- **Upstream:** not sent.
