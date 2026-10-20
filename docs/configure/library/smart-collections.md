# Smart Collections

Smart Collections are saved searches. They are populated dynamically whenever their contents are queried, as opposed to other types of collections whose contents are static. Smart Collections are created by clicking the save button on the search input.

## Using Smart Collections

Currently, the only way to utilize Smart Collections is to assign them to slots in either Slot Editor or Time Slot Editor. Smart Collection contents are queried at scheduled generation and are used to fill the slot.

## Channel References

The Usage column shows how many channels reference each smart collection in a saved slot schedule. Hover over the chip to see channel names and slot positions.

Deleting a collection warns with the affected channel names and slots, including bulk deletion. The warning does not prevent deletion; review the affected channels afterward.

Slot positions are numbered from 1 within the channel’s saved schedule. A channel counts once even if it references the same item several times. References refresh after channel or programming changes. If references cannot be loaded, the interface says so instead of reporting that the item is unused.
