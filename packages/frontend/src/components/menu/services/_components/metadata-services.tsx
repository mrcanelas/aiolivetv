import { useEffect, useMemo, useState } from 'react';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { fetchTmdbLanguages } from '@/lib/api';
import { SettingsCard } from '../../../shared/settings-card';
import { TextInput } from '../../../ui/text-input';
import { Combobox } from '../../../ui/combobox';

export function MetadataServices() {
  const { userData, setUserData } = useUserData();
  const { status } = useStatus();
  const apiKey = userData.tmdbApiKey?.trim();
  const accessToken = userData.tmdbAccessToken?.trim();
  const available = Boolean(
    apiKey || accessToken || status?.settings.tmdbApiAvailable
  );
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>(
    []
  );
  const [languageStatus, setLanguageStatus] = useState('');
  const language = userData.epgMetadataLanguage ?? 'en-US';

  useEffect(() => {
    setLanguages([]);
    if (!available) {
      setLanguageStatus('Configure TMDB credentials to load languages.');
      return;
    }
    const controller = new AbortController();
    setLanguageStatus('Loading TMDB languages…');
    const timer = setTimeout(async () => {
      try {
        const languages = await fetchTmdbLanguages(
          { apiKey, accessToken },
          controller.signal
        );
        if (!controller.signal.aborted) {
          setLanguages(languages);
          setLanguageStatus('');
        }
      } catch {
        if (!controller.signal.aborted) {
          setLanguageStatus(
            'Could not load TMDB languages. Check the configured credentials and reload the page to try again.'
          );
        }
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiKey, accessToken, available]);

  const options = useMemo(
    () =>
      languages
        .map(({ code, name }) => ({
          value: code,
          label: name + ' (' + code + ')',
          textValue: name + ' ' + code,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [languages]
  );

  return (
    <SettingsCard
      id="tmdb"
      title="TMDB"
      description="Configure optional metadata enrichment for EPG programmes."
    >
      <div className="space-y-3">
        <p className="text-xs text-[--muted]">
          Enrichment is enabled automatically when an API key or read access
          token is available. Fill missing descriptions, artwork and credits for
          confidently identified films and episodes. Programme titles are sent
          to TMDB. The guide remains available if enrichment fails.
        </p>
        {status?.settings.tmdbApiAvailable && (
          <p className="text-xs text-[--muted]">
            This instance provides TMDB credentials. You can enter your own
            below.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="TMDB API key"
            type="password"
            value={userData.tmdbApiKey ?? ''}
            onValueChange={(value) =>
              setUserData((current) => ({
                ...current,
                tmdbApiKey: value.trim() || undefined,
              }))
            }
            placeholder="Use the instance key or enter your own"
          />
          <TextInput
            label="TMDB read access token"
            type="password"
            value={userData.tmdbAccessToken ?? ''}
            onValueChange={(value) =>
              setUserData((current) => ({
                ...current,
                tmdbAccessToken: value.trim() || undefined,
              }))
            }
            placeholder="Optional alternative to an API key"
          />
          <Combobox
            label="Metadata language"
            aria-label="Metadata language"
            emptyMessage={languageStatus || 'No matching languages'}
            disabled={!languages.length}
            keepOpenOnSelect={false}
            value={[language]}
            options={options}
            onValueChange={(values) => {
              if (values[0])
                setUserData((current) => ({
                  ...current,
                  epgMetadataLanguage: values[0],
                }));
            }}
          />
          <p className="text-xs text-[--muted]" role="status">
            {languageStatus}
          </p>
        </div>
        <p className="text-xs text-[--muted]">
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </p>
      </div>
    </SettingsCard>
  );
}
