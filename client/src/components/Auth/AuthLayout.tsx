import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { TranslationKeys, useLocalize } from '~/hooks';
import SocialLoginRender from './SocialLoginRender';
import { BlinkAnimation } from './BlinkAnimation';
import { Banner } from '../Banners';
import { LOGO_PATH } from '~/utils/logoPath';
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
    <div className="relative flex min-h-screen flex-col bg-white dark:bg-gray-900">
      <Banner />
      <BlinkAnimation active={isFetching}>
        <div className="mt-12 h-24 w-full bg-cover">
          <img
            src={LOGO_PATH}
            className="h-full w-full object-contain"
            alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'LabsChat' })}
          />
        </div>
        <h1
          className="mb-6 mt-6 text-center text-3xl font-semibold text-brand-primary dark:text-brand-primary"
          style={{ userSelect: 'none' }}
        >
          {startupConfig?.appTitle}
        </h1>
      </BlinkAnimation>
      <DisplayError />
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
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <p className="hidden text-sm dark:text-white md:block">Capybara Labs</p>
        </div>
      </div>

      <div className="flex flex-grow items-center justify-center">
        <div className="w-authPageWidth overflow-hidden bg-white px-6 py-4 dark:bg-gray-900 sm:max-w-md sm:rounded-lg">
          {!hasStartupConfigError && !isFetching && header && (
            <h1
              className="mb-4 text-center text-2xl font-semibold text-black dark:text-white"
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
        </div>
      </div>
      <Footer startupConfig={startupConfig} />
    </div>
  );
}

export default AuthLayout;
