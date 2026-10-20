import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { FeatureFlagKey } from '@tunarr/types';

export const featureFlagMessages = {
  proxyArtwork: {
    displayName: msg`Proxy Artwork`,
    description: msg`Route artwork requests through the Tunarr server instead of using direct media source URLs.`,
  },
  tonemapEnabled: {
    displayName: msg`HDR Tonemapping`,
    description: msg`Enable HDR to SDR tonemapping during hardware-accelerated video transcoding.`,
  },
  webvttSidecarEnabled: {
    displayName: msg`WebVTT Sidecar Subtitles`,
    description: msg`Enable generation of WebVTT subtitle sidecar files during streaming.`,
  },
  xmltvCreditImagesEnabled: {
    displayName: msg`XMLTV Credit Images`,
    description: msg`Enable embedding images of people in the xmltv credit elements. (must regenerate xmltv to take effect)`,
  },
  disableSearchSnapshotInBackup: {
    displayName: msg`Disable Search Snapshot in Backup`,
    description: msg`Skip including the Meilisearch search snapshot when creating database backups.`,
  },
  disableVulkan: {
    displayName: msg`Disable Vulkan (NVIDIA)`,
    description: msg`Disable Vulkan-based processing in the NVIDIA hardware acceleration pipeline.`,
  },
  disableVaapiPad: {
    displayName: msg`Disable VAAPI Pad`,
    description: msg`Disable hardware-accelerated padding in the VAAPI video pipeline.`,
  },
} satisfies Record<
  FeatureFlagKey,
  {
    displayName: MessageDescriptor;
    description: MessageDescriptor;
  }
>;
