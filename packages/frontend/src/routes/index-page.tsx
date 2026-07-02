import { Button } from '@/components/ui/button';
import { useNavigate } from '@tanstack/react-router';
import {
  PRODUCT_LOGO_PATH,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
} from '@/constants/branding';

export function IndexPage() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <img
          src={PRODUCT_LOGO_PATH}
          alt={PRODUCT_NAME}
          className="max-h-[90px] object-contain"
        />
        <h1 className="text-3xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
        <p className="max-w-md text-[--muted]">{PRODUCT_TAGLINE}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          intent="primary"
          onClick={() => {
            navigate({ to: '/stremio/configure' });
          }}
        >
          Configure
        </Button>
        <Button
          intent="primary-outline"
          onClick={() => navigate({ to: '/dashboard' })}
        >
          Dashboard
        </Button>
        <Button
          intent="gray-outline"
          onClick={() =>
            window.open('https://docs.aiostreams.viren070.me', '_blank')
          }
        >
          Documentation
        </Button>
      </div>
    </main>
  );
}
