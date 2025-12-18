import { useEffect } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import type { TStartupConfig } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { ThemeSelector, Button } from '@librechat/client';
import { useLocalize } from '~/hooks';

export default function PublicPageLayout() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { data: startupConfig } = useGetStartupConfig({
    enabled: true,
  });

  useEffect(() => {
    if (startupConfig?.appTitle) {
      document.title = startupConfig.appTitle as TStartupConfig['appTitle'];
    }
  }, [startupConfig?.appTitle]);

  return (
    <div className="relative min-h-screen bg-surface-primary text-text-primary">
      <header className="bg-surface-secondary/70 supports-[backdrop-filter]:bg-surface-secondary/50 border-b border-border-light backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8 md:px-10">
          <div className="flex items-center gap-3">
            <img
              src="/assets/customization/logo.svg"
              className="h-9 w-auto object-contain"
              alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'Chat IA' })}
            />
            <span className="text-lg font-semibold text-text-primary">
              {startupConfig?.appTitle ?? 'Chat IA'}
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm font-medium">
            {/* <Link
              to="/login"
              className="text-text-secondary transition-colors hover:text-brand-primary"
            >
              {localize('com_auth_login')}
            </Link> */}
            <button
              onClick={() => navigate(-1)}
              className="rounded-lg bg-surface-submit px-3 py-2 text-white transition-colors hover:bg-surface-submit-hover"
            >
              {localize('com_ui_back')}
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 md:px-10">
        <Outlet />
      </main>

      <div className="absolute bottom-0 left-0 md:m-4">
        <ThemeSelector />
      </div>

      <div className="absolute bottom-0 right-0 md:m-4">
        <div className="flex flex-col items-center justify-center p-4 md:p-2">
          <img
            src="/assets/developers-logo.svg"
            className="h-8 w-8 object-contain"
            alt={localize('com_ui_logo', { 0: 'Capybara Labs' })}
          />
          <p className="hidden text-sm dark:text-white md:block">Capybara Labs</p>
        </div>
      </div>
    </div>
  );
}
