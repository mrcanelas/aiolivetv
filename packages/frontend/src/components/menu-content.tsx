import { useMenu } from '@/context/menu';
import { AddonsMenu } from './menu/addons';
import { AboutMenu } from './menu/about';
import { MiscellaneousMenu } from './menu/miscellaneous';
import { SaveInstallMenu } from './menu/save-install';
import { FormatterMenu } from './menu/formatter';
import { ChannelsMenu } from './menu/channels';

export function MenuContent() {
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
