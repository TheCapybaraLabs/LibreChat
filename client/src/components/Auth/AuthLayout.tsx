import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { TranslationKeys, useLocalize } from '~/hooks';
import SocialLoginRender from './SocialLoginRender';
import { BlinkAnimation } from './BlinkAnimation';
import { Banner } from '../Banners';
import Footer from './Footer';

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
      <img
        src="/assets/customization/brand-logo.png"
        className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-20 blur-3xl"
        alt=""
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-surface-primary via-surface-primary/95 to-surface-secondary/90" />

      <Banner />

      <div className="absolute bottom-0 left-0 z-20 md:m-4">
        <ThemeSelector />
      </div>

      <div className="absolute bottom-0 right-0 z-20 md:m-4">
        <div className="flex flex-col items-center justify-center p-4 md:p-2">
          <img
            src="/assets/developers-logo.svg"
            className="h-8 w-8 object-contain"
            alt={localize('com_ui_logo', { 0: 'Capybara Labs' })}
          />
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <p className="hidden text-sm text-text-primary md:block">Capybara Labs</p>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 md:px-8">
        <div className="grid w-full max-w-6xl overflow-hidden rounded-3xl border border-border-light bg-surface-dialog shadow-2xl backdrop-blur-md md:grid-cols-2">
          <section className="relative hidden min-h-[560px] overflow-hidden md:flex">
            <img
              src="/assets/customization/brand-logo.png"
              className="absolute inset-0 h-full w-full object-cover opacity-90"
              alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'Chat IA' })}
            />
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
            <div className="relative z-10 flex h-full w-full flex-col items-center justify-center p-10 text-center">
              <img
                src="/assets/customization/logo.svg"
                className="h-28 w-full object-contain"
                alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'Chat IA' })}
              />
              <h2 className="mt-8 text-3xl font-semibold text-white" style={{ userSelect: 'none' }}>
                {startupConfig?.appTitle}
              </h2>
            </div>
          </section>

          <section className="flex min-h-[560px] flex-col justify-center px-6 py-8 sm:px-10">
            <BlinkAnimation active={isFetching}>
              <div className="mb-8 flex items-center justify-center md:hidden">
                <img
                  src="/assets/customization/logo.svg"
                  className="h-16 w-full object-contain"
                  alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'Chat IA' })}
                />
              </div>
            </BlinkAnimation>

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
