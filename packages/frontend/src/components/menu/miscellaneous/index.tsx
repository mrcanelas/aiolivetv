import { CONFIGURE_VISIBLE_MISC_SUB_TABS, CONFIGURE_DEFAULT_MISC_SUB_TAB } from '@/constants/configure-menus';
import { PageWrapper } from '../../shared/page-wrapper';
import { PageControls } from '../../shared/page-controls';
import { MenuTabs } from '../../shared/menu-tabs';
import { useMode } from '@/context/mode';
import { useSubTab } from '@/context/sub-tab';
import { FaEye, FaPlay } from 'react-icons/fa';
import { FiSettings, FiLink } from 'react-icons/fi';
import { DisplayDebug } from './_components/display-debug';
import { ParentConfig } from './_components/parent-config';
import { StreamProbeSettings } from './_components/stream-probe-settings';

export function MiscellaneousMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { mode } = useMode();
  const { tab: activeTab, setTab: handleTabChange } =
    useSubTab('miscellaneous');

  const tabs = [
    {
      value: 'playback',
      label: 'Playback',
      icon: <FaPlay className="w-4 h-4" />,
      content: (
        <div className="space-y-6">
          <StreamProbeSettings />
        </div>
      ),
    },
    {
      value: 'display',
      label: 'Display',
      icon: <FaEye className="w-4 h-4" />,
      content:
        mode === 'pro' ? (
          <DisplayDebug />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <FiSettings className="w-10 h-10 text-[--muted]" />
            <p className="text-lg font-semibold">Advanced Mode Required</p>
            <p className="text-sm text-[--muted]">
              Display settings are only available in Advanced mode.
            </p>
          </div>
        ),
    },
    {
      value: 'parent',
      label: 'Parent Config',
      icon: <FiLink className="w-4 h-4" />,
      content: <ParentConfig />,
    },
  ].filter((tab) =>
    (CONFIGURE_VISIBLE_MISC_SUB_TABS as readonly string[]).includes(tab.value)
  );

  const resolvedTab = tabs.some((tab) => tab.value === activeTab)
    ? activeTab
    : CONFIGURE_DEFAULT_MISC_SUB_TAB;

  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Miscellaneous</h2>
          <p className="text-[--muted]">
            Additional settings and configurations.
          </p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      <MenuTabs
        tabs={tabs}
        activeTab={resolvedTab}
        onTabChange={handleTabChange}
      />
    </>
  );
}
