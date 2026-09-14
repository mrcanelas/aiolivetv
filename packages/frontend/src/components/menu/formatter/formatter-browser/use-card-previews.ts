import { useEffect, useMemo, useState } from 'react';
import type { FormatterDefinition } from '../../../../../../core/src/utils/formatter-definitions';
import { useUserData } from '@/context/userData';
import { getFormattedStream } from '@/lib/api';
import { buildPreviewStream, loadPreviewInput } from '../preview/state';

export interface CardPreview {
  name?: string;
  description?: string;
  error?: string;
}

/**
 * Render every definition against the current preview sample so the picker
 * cards match the panel below.
 */
export function useCardPreviews(
  definitions: Record<string, FormatterDefinition>,
  enabled: boolean
): Record<string, CardPreview> {
  const { userData } = useUserData();
  const [previews, setPreviews] = useState<Record<string, CardPreview>>({});
  const input = useMemo(() => loadPreviewInput(), [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (Object.keys(definitions).length === 0) {
      setPreviews((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    let cancelled = false;
    const stream = buildPreviewStream(input);
    (async () => {
      const entries = await Promise.all(
        Object.entries(definitions).map(
          async ([key, definition]): Promise<[string, CardPreview]> => {
            try {
              const formatted = await getFormattedStream(stream, {
                userData: {
                  ...userData,
                  formatter: {
                    id: 'custom',
                    definitions: { custom: definition },
                  },
                },
                maxRegexScore: input.maxRegexScore,
                maxSeScore: input.maxSeScore,
                title: input.channelName || 'AXN',
                type: 'tv',
                queryType: 'channel',
              });
              return [key, formatted];
            } catch (error) {
              return [
                key,
                {
                  error:
                    error instanceof Error ? error.message : String(error),
                },
              ];
            }
          }
        )
      );
      if (!cancelled) setPreviews(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [definitions, enabled, userData, input]);

  return previews;
}
