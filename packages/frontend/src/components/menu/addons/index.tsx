import React, { useState, useMemo } from 'react';
import { PageWrapper } from '../../shared/page-wrapper';
import { useStatus } from '@/context/status';
import { useUserData, useParentInheritance } from '@/context/userData';
import { InheritedBadge } from '../../shared/inherited-badge';
import { Card } from '../../ui/card';
import { TextInput } from '../../ui/text-input';
import { SearchIcon } from 'lucide-react';
import { StaticTabs } from '../../ui/tabs';
import { LuDownload, LuGlobe, LuSettings } from 'react-icons/lu';
import { AnimatePresence } from 'framer-motion';
import { PageControls } from '../../shared/page-controls';
import { IoExtensionPuzzle } from 'react-icons/io5';
import { MdOutlineDataset } from 'react-icons/md';
import { RiFolderDownloadFill } from 'react-icons/ri';
import { toast } from 'sonner';
import * as constants from '../../../../../core/src/utils/constants';

import { AddonCard } from './_components/addon-card';
import { AddonModal } from './_components/addon-modal';
import { MyAddons } from './_components/my-addons';

export function AddonsMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { status } = useStatus();
  const { userData, setUserData } = useUserData();
  const { hasParent, isInherited } = useParentInheritance();
  const [page, setPage] = useState<'installed' | 'marketplace'>('installed');

  const [search, setSearch] = useState('');
  const [marketplaceCategoryFilter, setMarketplaceCategoryFilter] = useState<
    constants.PresetCategory | 'all'
  >('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [modalPreset, setModalPreset] = useState<any | null>(null);
  const [modalInitialValues, setModalInitialValues] = useState<
    Record<string, any>
  >({});
  const [editingAddonId, setEditingAddonId] = useState<string | null>(null);

  const filteredPresets = useMemo(() => {
    if (!status?.settings?.presets) return [];
    let filtered = [
      ...status.settings.presets.filter(
        (n) =>
          !n.DISABLED?.removed &&
          [
            constants.PresetCategory.STREAMS,
            constants.PresetCategory.META_CATALOGS,
            constants.PresetCategory.MISC,
          ].includes(n.CATEGORY ?? constants.PresetCategory.STREAMS)
      ),
    ];
    if (marketplaceCategoryFilter !== 'all') {
      filtered = filtered.filter(
        (n) =>
          (n.CATEGORY || constants.PresetCategory.STREAMS) ===
          marketplaceCategoryFilter
      );
    }
    filtered = filtered.filter(
      (n) =>
        n.SUPPORTED_STREAM_TYPES &&
        n.SUPPORTED_STREAM_TYPES.includes('live')
    );
    if (search) {
      filtered = filtered.filter(
        (n) =>
          n.NAME.toLowerCase().includes(search.toLowerCase()) ||
          n.DESCRIPTION.toLowerCase().includes(search.toLowerCase())
      );
    }
    return filtered;
  }, [status, search, marketplaceCategoryFilter]);

  function handleAddPreset(preset: any) {
    setModalPreset(preset);
    setModalInitialValues({
      options: Object.fromEntries(
        (preset.OPTIONS || []).map((opt: any) => [
          opt.id,
          opt.forced ?? opt.default ?? undefined,
        ])
      ),
    });
    setModalMode('add');
    setEditingAddonId(null);
    setModalOpen(true);
  }

  function getUniqueId() {
    const id = Math.floor(Math.random() * 0xfff)
      .toString(16)
      .padStart(3, '0');
    if (userData.presets.some((a) => a.instanceId === id)) {
      return getUniqueId();
    }
    return id;
  }

  function handleModalSubmit(values: Record<string, any>) {
    if (modalMode === 'add' && modalPreset) {
      const newPreset = {
        type: modalPreset.ID,
        instanceId: getUniqueId(),
        enabled: true,
        options: values.options,
      };
      const newKey = getPresetUniqueKey(newPreset);
      if (userData.presets.some((a) => getPresetUniqueKey(a) === newKey)) {
        toast.error('You already have an addon with the same options added.');
        setModalOpen(false);
        return;
      }
      setUserData((prev) => ({
        ...prev,
        presets: [...prev.presets, newPreset],
      }));
      toast.info('Addon installed successfully!');
      setModalOpen(false);
    } else if (modalMode === 'edit' && editingAddonId) {
      setUserData((prev) => ({
        ...prev,
        presets: prev.presets.map((a) =>
          a.instanceId === editingAddonId
            ? { ...a, options: values.options }
            : a
        ),
      }));
      toast.info('Addon updated successfully!');
      setModalOpen(false);
    }
  }

  function handleEditFromMyAddons(preset: any, presetMetadata: any) {
    setModalPreset(presetMetadata);
    setModalInitialValues({
      options: { ...preset.options },
    });
    setModalMode('edit');
    setEditingAddonId(preset.instanceId);
    setModalOpen(true);
  }

  const streamPresets = filteredPresets.filter(
    (n) => n.CATEGORY === constants.PresetCategory.STREAMS || !n.CATEGORY
  );
  const metaCatalogPresets = filteredPresets.filter(
    (n) => n.CATEGORY === constants.PresetCategory.META_CATALOGS
  );
  const miscPresets = filteredPresets.filter(
    (n) => n.CATEGORY === constants.PresetCategory.MISC
  );

  const addonGridClassName =
    'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5 5xl:grid-cols-6 6xl:grid-cols-7 7xl:grid-cols-8 gap-4';

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <StaticTabs
          className="h-10 w-fit max-w-full border rounded-full"
          triggerClass="px-4 py-1 text-md"
          items={[
            {
              name: 'Installed',
              isCurrent: page === 'installed',
              onClick: () => setPage('installed'),
              iconType: LuDownload,
            },
            {
              name: 'Marketplace',
              isCurrent: page === 'marketplace',
              onClick: () => setPage('marketplace'),
              iconType: LuGlobe,
            },
          ]}
        />

        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {page === 'installed' && (
          <PageWrapper
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{
              duration: 0.35,
            }}
            key="installed"
            className="pt-0 space-y-6 relative z-[4]"
          >
            <div>
              <div className="flex items-center gap-2">
                <h2 className="flex items-center gap-2">
                  <IoExtensionPuzzle className="w-5 h-5" />
                  Installed
                </h2>
                {hasParent && isInherited('presets') && (
                  <InheritedBadge section="presets" />
                )}
              </div>
              <p className="text-[--muted] text-sm">
                Manage your Live TV sources. Channels are unified in the
                Channels page.
              </p>
            </div>
            <MyAddons onEdit={handleEditFromMyAddons} />
          </PageWrapper>
        )}

        {page === 'marketplace' && (
          <PageWrapper
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{
              duration: 0.35,
            }}
            key="marketplace"
            className="pt-0 space-y-6 relative z-[4]"
          >
            <>
              <div>
                <h2>Marketplace</h2>
                <p className="text-[--muted] text-sm">
                  Browse and install addons from the marketplace.
                </p>
              </div>

              <StaticTabs
                className="h-10 w-fit max-w-full border rounded-full"
                triggerClass="px-4 py-1 text-sm"
                items={[
                  {
                    name: 'All',
                    isCurrent: marketplaceCategoryFilter === 'all',
                    onClick: () => setMarketplaceCategoryFilter('all'),
                  },
                  {
                    name: 'Streams',
                    isCurrent:
                      marketplaceCategoryFilter ===
                      constants.PresetCategory.STREAMS,
                    onClick: () =>
                      setMarketplaceCategoryFilter(
                        constants.PresetCategory.STREAMS
                      ),
                  },
                  {
                    name: 'Metadata & Catalogs',
                    isCurrent:
                      marketplaceCategoryFilter ===
                      constants.PresetCategory.META_CATALOGS,
                    onClick: () =>
                      setMarketplaceCategoryFilter(
                        constants.PresetCategory.META_CATALOGS
                      ),
                  },
                  {
                    name: 'Miscellaneous',
                    isCurrent:
                      marketplaceCategoryFilter ===
                      constants.PresetCategory.MISC,
                    onClick: () =>
                      setMarketplaceCategoryFilter(
                        constants.PresetCategory.MISC
                      ),
                  },
                ]}
              />

              <div className="flex flex-col lg:flex-row gap-2">
                <TextInput
                  value={search}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setSearch(e.target.value)
                  }
                  placeholder="Search addons..."
                  className="flex-1"
                  leftIcon={<SearchIcon className="w-4 h-4" />}
                />
              </div>

              {filteredPresets.length === 0 && (
                <Card className="p-8 text-center">
                  <p className="text-[--muted]">
                    No addons found matching your criteria.
                  </p>
                </Card>
              )}

              {!!streamPresets?.length && (
                <Card className="p-4 space-y-6">
                  <h3 className="flex gap-3 items-center">
                    <RiFolderDownloadFill /> Streams
                  </h3>
                  <div className={addonGridClassName}>
                    {streamPresets.map((preset: any) => (
                      <AddonCard
                        key={preset.ID}
                        preset={preset}
                        onAdd={() => handleAddPreset(preset)}
                      />
                    ))}
                  </div>
                </Card>
              )}

              {!!metaCatalogPresets?.length && (
                <Card className="p-4 space-y-6">
                  <h3 className="flex gap-3 items-center">
                    <MdOutlineDataset /> Metadata & Catalogs
                  </h3>
                  <div className={addonGridClassName}>
                    {metaCatalogPresets.map((preset: any) => (
                      <AddonCard
                        key={preset.ID}
                        preset={preset}
                        onAdd={() => handleAddPreset(preset)}
                      />
                    ))}
                  </div>
                </Card>
              )}

              {!!miscPresets?.length && (
                <Card className="p-4 space-y-6">
                  <h3 className="flex gap-3 items-center">
                    <LuSettings /> Miscellaneous
                  </h3>
                  <div className={addonGridClassName}>
                    {miscPresets.map((preset: any) => (
                      <AddonCard
                        key={preset.ID}
                        preset={preset}
                        onAdd={() => handleAddPreset(preset)}
                      />
                    ))}
                  </div>
                </Card>
              )}
            </>
          </PageWrapper>
        )}
      </AnimatePresence>
      <AddonModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mode={modalMode}
        presetMetadata={modalPreset}
        initialValues={modalInitialValues as any}
        onSubmit={handleModalSubmit}
      />
    </>
  );
}

function getPresetUniqueKey(preset: {
  type: string;
  instanceId: string;
  enabled: boolean;
  options: Record<string, any>;
}) {
  return JSON.stringify({
    type: preset.type,
    enabled: preset.enabled,
    options: preset.options,
  });
}
