import { useMenu } from '@/context/menu';
import { lazy, Suspense } from 'react';
import { LoadingSpinner } from './ui/loading-spinner';
import { AboutMenu } from './menu/about';
const AddonsMenu = lazy(() =>
  import('./menu/addons').then((module) => ({ default: module.AddonsMenu }))
);
const MiscellaneousMenu = lazy(() =>
  import('./menu/miscellaneous').then((module) => ({
    default: module.MiscellaneousMenu,
  }))
);
const SaveInstallMenu = lazy(() =>
  import('./menu/save-install').then((module) => ({
    default: module.SaveInstallMenu,
  }))
);
const FormatterMenu = lazy(() =>
  import('./menu/formatter').then((module) => ({
    default: module.FormatterMenu,
  }))
);
const ChannelsMenu = lazy(() =>
  import('./menu/channels').then((module) => ({ default: module.ChannelsMenu }))
);

export function MenuContent() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SelectedMenu />
    </Suspense>
  );
}

function SelectedMenu() {
  const { selectedMenu } = useMenu();

  switch (selectedMenu) {
    case 'about':
      return <AboutMenu />;
    case 'addons':
      return <AddonsMenu />;
    case 'channels':
      return <ChannelsMenu />;
    case 'formatter':
      return <FormatterMenu />;
    case 'miscellaneous':
      return <MiscellaneousMenu />;
    case 'save-install':
      return <SaveInstallMenu />;
    default:
      return (
        <div className="p-8">
          <h2 className="text-2xl font-bold mb-4">{selectedMenu}</h2>
          <p className="text-gray-400">This section is under construction.</p>
        </div>
      );
  }
}
