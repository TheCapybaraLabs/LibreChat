import { ThemeSelector } from '@librechat/client';
import type { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { type TranslationKeys, useLocalize } from '~/hooks';
import { CLIENT_BANNER, DEV_LOGO, PLATFORM_IMAGE } from '~/utils/logoPath';
import { Banner } from '../Banners';
import Footer from './Footer';
import SocialLoginRender from './SocialLoginRender';

function AuthLayout({
  children,
  header,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
}) {
  const localize = useLocalize();

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const DisplayError = () => {
    if (hasStartupConfigError) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize('com_auth_error_login_server')}</ErrorMessage>
        </div>
      );
    } else if (error === 'com_auth_error_invalid_reset_token') {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>
            {localize('com_auth_error_invalid_reset_token')}{' '}
            <a className="font-semibold text-brand-primary hover:underline" href="/forgot-password">
              {localize('com_auth_click_here')}
            </a>{' '}
            {localize('com_auth_to_try_again')}
          </ErrorMessage>
        </div>
      );
    } else if (error != null && error) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize(error)}</ErrorMessage>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-surface-primary">
      <Banner />

      <div className="absolute bottom-0 left-0 z-20 md:m-4">
        <ThemeSelector />
      </div>

      <div className="absolute bottom-0 right-0 z-20 md:m-4">
        <div className="flex flex-col items-center justify-center p-4 md:p-2">
          <img
            src={DEV_LOGO}
            className="h-8 w-8 object-contain"
            alt={localize('com_ui_logo', { 0: 'Capybara Labs' })}
          />
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <p className="hidden text-sm text-text-primary md:block">Capybara Labs</p>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 md:px-8">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-border-light bg-surface-dialog shadow-2xl backdrop-blur-md md:grid-cols-2">
          <section className="hidden min-h-[560px] overflow-hidden md:flex">
            <img
              src={PLATFORM_IMAGE}
              className="h-full w-full object-cover"
              alt=""
              aria-hidden="true"
            />
          </section>

          <section className="flex min-h-[560px] flex-col justify-center px-6 py-8 sm:px-10">
            {CLIENT_BANNER && (
              <div className="mb-6 flex items-center justify-center">
                <img
                  src={CLIENT_BANNER}
                  className="max-h-20 w-full object-contain"
                  alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'LabsChat' })}
                />
              </div>
            )}

            <DisplayError />

            {!hasStartupConfigError && !isFetching && header && (
              <h1
                className="mb-4 text-center text-2xl font-semibold text-text-primary"
                style={{ userSelect: 'none' }}
              >
                {header}
              </h1>
            )}

            {children}
            {!pathname.includes('2fa') &&
              (pathname.includes('login') || pathname.includes('register')) && (
                <SocialLoginRender startupConfig={startupConfig} />
              )}
          </section>
        </div>
      </div>

      <Footer startupConfig={startupConfig} />
    </div>
  );
}

export default AuthLayout;
