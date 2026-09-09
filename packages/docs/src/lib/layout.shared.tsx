import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';
import { DonateIconButton } from '@/components/donate-button';

export const gitConfig = {
  user: 'mrcanelas',
  repo: 'aiolivetv',
  branch: 'main',
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span className="relative inline-flex h-6 w-6 shrink-0">
            <Image
              src="/logo-light.png"
              alt="AIOLiveTV"
              fill
              className="object-contain transition-opacity duration-300 dark:opacity-0"
            />
            <Image
              src="/logo-dark.png"
              alt=""
              fill
              className="object-contain transition-opacity duration-300 opacity-0 dark:opacity-100"
            />
          </span>
          AIOLiveTV
        </>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        type: 'custom',
        secondary: true,
        children: <DonateIconButton />,
      },
    ],
  };
}
