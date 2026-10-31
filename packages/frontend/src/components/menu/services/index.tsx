import { PageWrapper } from '../../shared/page-wrapper';
import { PageControls } from '../../shared/page-controls';
import { MetadataServices } from './_components/metadata-services';

export function ServicesMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <div className="flex items-center w-full">
        <div>
          <h2>Services</h2>
          <p className="text-[--muted]">
            Configure programme metadata services.
          </p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>
      <MetadataServices />
    </PageWrapper>
  );
}
