import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { SiGithubsponsors } from 'react-icons/si';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      links={[
        {
          type: 'icon',
          text: 'GitHub Sponsors',
          url: 'https://github.com/sponsors/mrcanelas',
          icon: <SiGithubsponsors />,
          external: true,
        },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
