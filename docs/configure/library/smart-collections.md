# Smart Collections

Smart Collections are saved searches. They are populated dynamically whenever their contents are queried, as opposed to other types of collections whose contents are static.

## Creating and editing Smart Collections

From **Library → Smart Collections**, choose **Create**. Search opens with the reminder "Build the query, then Save as collection". Enter keywords and a filter using either the text filter or visual builder, then choose **Save as collection**, enter a name, and save. You return to the Smart Collections list. You can also save a search directly from the regular Search page using its save button.

Choose **Edit** on a Smart Collection to change its name, keywords, or filter. The same text and visual filter builders are available here. Save applies the query to future uses of the collection; Cancel leaves it unchanged. Clearing the keywords and filter saves an unrestricted query.

## Using Smart Collections

Currently, the only way to utilize Smart Collections is to assign them to slots in either Slot Editor or Time Slot Editor. Smart Collection contents are queried at scheduled generation and are used to fill the slot.

## Channel References

The Usage column shows how many channels reference each smart collection in a saved slot schedule. Hover over the chip to see channel names and slot positions.

Deleting a collection warns with the affected channel names and slots, including bulk deletion. The warning does not prevent deletion; review the affected channels afterward.

Slot positions are numbered from 1 within the channel’s saved schedule. A channel counts once even if it references the same item several times. References refresh after channel or programming changes. If references cannot be loaded, the interface says so instead of reporting that the item is unused.
