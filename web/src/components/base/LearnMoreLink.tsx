import { Trans } from '@lingui/react/macro';
import Link from '@mui/material/Link';
import type { DocsPage } from '../../helpers/docsLinks.ts';
import { docsUrl } from '../../helpers/docsLinks.ts';

type Props = {
  page: DocsPage;
};

/**
 * A "Learn more" link to the user docs, for a setting whose full explanation
 * lives there. Opens in a new tab so unsaved changes stay put.
 */
export function LearnMoreLink({ page }: Props) {
  return (
    <Link href={docsUrl(page)} target="_blank" rel="noopener noreferrer">
      <Trans>Learn more</Trans>
    </Link>
  );
}
