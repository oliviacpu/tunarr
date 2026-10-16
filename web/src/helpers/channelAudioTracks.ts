// A channel's audio track layout as typed in its settings: "eng, jpn" or
// "eng jpn" -> ['eng', 'jpn']. Validation is the schema's job.
export function parseAudioTracks(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code.length > 0);
}
