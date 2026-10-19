# Plex

Once you have your channels created with programming/shows added, head over to Plex > Settings icon > Manage > Live TV & DVR > Set Up Plex Tuner.

![Plex settings](/assets/plex-settings.png)

![Plex settings DVR](/assets/plex-settings-dvr.png)

![Plex settings tuner](/assets/plex-settings-tuner.png)

Plex should already detect Tunarr and you should see your servers IP address. If you do not, select "Don't see your HDHomeRun device? Enter its network address manually". Use the following format replacing serverIP with your servers IP address: e.g. `http://serverIP:8000`

Once your server is shown, select "Have an XMLTV guide on your server? Click here to use it."

![Plex settings tuner 2](/assets/plex-settings-tuner2.png)

In the "XMLTV GUIDE" field, use the following template replacing serverIP with your Tunarr servers IP address: e.g. `http://serverIP:8000/api/xmltv.xml`

Select "Continue"

![Plex settings XMLTV](/assets/plex-settings-xmltv.png)

Your channels should automatically be mapped. Select "Continue".

![Plex settings channels](/assets/plex-settings-channels.png)

Plex should now display your Tunarr channels in the Live TV section. Select "View Guide" to be brought directly there.

![Plex settings view guide](/assets/plex-settings-viewguide.png)

### Guide updates

When a Plex media source has **Send guide updates** on, Tunarr asks that Plex server to reload its guide after each guide write. Writes less than 10 seconds apart, such as saving several channels in a row, lead to one ask, 10 seconds after the last. An ask made while Tunarr starts waits until Plex can download the guide. Every Plex server is asked at the same time, so one that fails or doesn't answer doesn't hold up the others. A failed ask is tried three times, 5 and then 15 seconds apart. If all three fail, Plex keeps its guide until the next guide write. If Plex refuses Tunarr's token (HTTP 401 or 403), or the media source has no token, Tunarr doesn't try again and logs a warning to check that media source's Plex token. The next guide write asks again.

A script that saves channels and then checks Plex's guide can call `POST /api/xmltv/flush` once its saves have returned. It answers when the guide writes those saves started have finished and Plex has been asked, or after 30 seconds at the latest. The status is 200 when everything finished and 202 when it stopped waiting with something still under way. The answer has `done` (`false` if it stopped waiting) and, for each Plex server asked, how the ask ended: `reloaded`, `no_live_tv`, `auth_failed`, `failed`, or `pending` if it hadn't finished. For example: `{"done": true, "servers": [{"name": "Plex", "outcome": "reloaded"}]}`.

### Posters in the guide

Plex's apps load guide pictures (programme posters, channel logos) themselves, from the addresses in the XMLTV file. Those addresses start with the one Plex used to fetch the guide. If that address only works on the server, such as `http://127.0.0.1:8000`, the apps can't load the pictures and show plain titles instead.

Gaps between programmes (flex) show the channel's offline picture, which is what airs during them, or the channel's logo when it has none.

A new channel logo appears in Plex after Plex next refreshes the guide: daily by default, right away with **Refresh Guide** in Plex's Live TV & DVR settings, or when Tunarr asks it to after a guide change (the media source's **Send guide updates**). A guide refresh keeps playing Live TV streams; only changing the channel map ends them.

To fix this, set **Public Address for Guide Pictures** (Settings → XMLTV) to an address the apps can reach, such as `https://tunarr.example.com`. The guide's picture links then use it. Plex keeps fetching the guide from its usual address. The picture paths (`/media/artwork/…`, `/api/programs/<id>/artwork/<type>`, `/api/credits/<id>/artwork/<type>` and `/images/…`) must be reachable at that address without a login.

Images uploaded in the web UI (channel logos, offline pictures) are saved with that address too, so they load in Plex's apps even when you upload them from a browser on the server (`localhost`) or behind a proxy that terminates HTTPS. Without it, an upload gets the address the browser used, and behind such a proxy Tunarr sees plain `http://`. Images uploaded before you set it keep their saved address; upload them again to change it.

Each time Tunarr writes the guide, it saves every programme's poster as a file in the `media/artwork` folder of its data directory and links the guide to it, such as `/media/artwork/<id>-poster.jpg?v=20261015041230`. The `v` is the second Tunarr saved that picture, and it changes only when the picture's bytes do, so Plex and its apps fetch a replaced poster once and can cache the rest for good. Each version stays at its own address for 30 days after it's replaced, so a guide Plex fetched earlier keeps its pictures. A rescan that finds the same picture keeps its address. A poster Tunarr can't save keeps the `/api/programs/…` address. Pictures no guide has used for 30 days are deleted.

Play your channel by hovering over the channel icon and selecting the play icon.

![Plex settings guide](/assets/plex-settings-guide.png)

!!! warning

    Please note, at the time of writing the Plex Windows client is not currently supported and will yield a "This Live TV session has ended" error. Windows users should use the web browser client located at http://serverIP:32400/web until this is resolved. This issue is tracked in <a href="https://github.com/chrisbenincasa/tunarr/issues/718" target="_blank">chrisbenincasa/tunarr#718</a>
