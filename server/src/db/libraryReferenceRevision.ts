let revision = 0;

export const libraryReferenceRevision = () => revision;

export function invalidateLibraryReferences() {
  revision++;
}
