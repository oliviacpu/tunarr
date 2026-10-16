import { useLingui } from '@lingui/react/macro';
import type { CaptionAlignment } from '@tunarr/types/schemas';

// The names closed-caption alignments are shown with, for the alignment
// selects on the FFmpeg settings page and a channel's own caption settings
export function useCaptionAlignmentNames(): Record<CaptionAlignment, string> {
  const { t } = useLingui();
  return {
    centeredBlock: t`Centered block (lines start in the same column)`,
    centeredLines: t`Each line centered`,
    left: t`Left`,
  };
}
