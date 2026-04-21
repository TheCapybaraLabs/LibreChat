import { ThemeSelector } from '@librechat/client';
import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { CLIENT_BANNER, DEV_LOGO } from '~/utils/logoPath';

export default function PublicPageLayout() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { data: startupConfig } = useGetStartupConfig({
    enabled: true,
  });

  useEffect(() => {
    document.title = startupConfig?.appTitle ?? 'LabsChat';
  }, [startupConfig?.appTitle]);

  return (
    <div className="relative min-h-screen bg-surface-primary text-text-primary">
      <header className="bg-surface-secondary/70 supports-[backdrop-filter]:bg-surface-secondary/50 border-b border-border-light backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8 md:px-10">
          <div className="flex items-center gap-3">
            <img
              src={CLIENT_BANNER ?? '/assets/customization/logo.svg'}
              className="h-9 w-auto object-contain"
              alt={localize('com_ui_logo', {
                0: startupConfig?.appTitle ?? 'LabsChat',
              })}
            />
            <span className="text-lg font-semibold text-text-primary">
              {startupConfig?.appTitle ?? 'LabsChat'}
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm font-medium">
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
            src={DEV_LOGO}
            className="h-8 w-8 object-contain"
            alt={localize('com_ui_logo', { 0: 'Capybara Labs' })}
          />
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <p className="hidden text-sm dark:text-white md:block">Capybara Labs</p>
        </div>
      </div>
    </div>
  );
}
