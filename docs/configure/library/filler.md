# Filler

Filler lists are collections of content that are used by [Flex](/configure/channels/flex) to pad time between episodes. One reason to use Filler is to simulate traditional television by playing advertisements between episode airings. 

There are many places to source filler videos from. [DizqueTV's Wiki](https://github.com/vexorian/dizquetv/wiki) has plenty of filler repositories listed. Many of these are YouTube playlists, so you can use tools like MeTube to rip the playlist, and then add a new library to Plex with these filler videos, which can then be used by Tunarr's Filler lists. 

To get started, from the side panel select "Library", "EDIT FILLERS", then "NEW".

![Library](/assets/library.png)

![Filler](/assets/library-filler.png)

![Filler new](/assets/library-filler-new.png)

Add a name for your filler list, then select "ADD MEDIA". 

![Filler new add media](/assets/library-filler-new-addmedia.png)

Select the library with your Filler content, then select "ADD MOVIE" for each item you'd like to include. 

![Filler new add media 2](/assets/library-filler-new-addmedia2.png)

Expand the menu on the right to view a summary of your changes, then select "ADD ITEMS" followed by "SAVE". 

Save is enabled once the name or the programs have changed, and needs at least one program. "Reset changes" puts back
the saved name and programs. Leaving the page with unsaved changes asks first; going to "ADD MEDIA" and back keeps
them.

![Filler menu](/assets/library-filler-menu.png)

![Filler add items](/assets/library-filler-additems.png)

![Filler add items save](/assets/library-filler-save.png)

To use a filler list with your channels, edit your channel and select the [Flex](/configure/channels/flex) tab.

For how Tunarr decides which clip to play at each break, see [How Filler Is Chosen](/configure/library/filler-selection).

## Filler Types

When using slot-based scheduling tools ([Slot Editor](/configure/scheduling/random-slots), [Time Slots](/configure/scheduling/time-slots)), filler lists can be assigned to specific positions within a slot:

| Type | When it plays |
|------|--------------|
| **Head** | At the beginning of each slot |
| **Pre** | Before each program within a slot |
| **Post** | After each program within a slot |
| **Tail** | At the end of each slot |
| **Mid** | During [mid-roll breaks](/configure/scheduling/mid-roll-breaks) inserted within a program |
| **Fallback** | During flex time in the slot |

!!! note
    These filler types are only available in slot-based schedulers. When adding filler directly to a channel via the Flex tab, the filler is used to fill flex time only.

For details on mid-roll breaks, see the [Mid-Roll Breaks](/configure/scheduling/mid-roll-breaks) scheduling guide.

## Channel References

The Usage column shows how many channels reference each filler list. Hover over the chip to see channel names and any slot positions. This includes lists attached on a channel’s Flex tab, slot filler, scheduled filler items, and offline music.

Deleting a list warns with the affected channel names and slots, including bulk deletion. The warning does not prevent deletion; review the affected channels afterward.

Slot positions are numbered from 1 within the channel’s saved schedule. A channel counts once even if it references the same item several times. References refresh after channel or programming changes. If references cannot be loaded, the interface says so instead of reporting that the item is unused.
