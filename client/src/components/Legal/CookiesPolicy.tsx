import { useEffect, useMemo } from 'react';
import { useGetStartupConfig } from '~/data-provider';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { useLocalize } from '~/hooks';

export default function CookiesPolicy() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const cookiesPolicy = startupConfig?.interface?.cookiesPolicy;

  const externalUrl = cookiesPolicy?.externalUrl;
  const title = cookiesPolicy?.modalTitle ?? localize('com_ui_cookies_policy');
  const content = useMemo(() => {
    const raw = cookiesPolicy?.modalContent;
    if (typeof raw === 'string') {
      return raw;
    }
    if (Array.isArray(raw)) {
      return raw.join('\n');
    }
    return '';
  }, [cookiesPolicy?.modalContent]);

  useEffect(() => {
    if (externalUrl) {
      window.location.replace(externalUrl);
    }
  }, [externalUrl]);

  if (externalUrl) {
    return null;
  }

  return (
    <div className="bg-surface-primary text-text-primary">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 py-10 pb-5 pt-2 sm:px-8 md:px-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-text-primary">{title}</h1>
        </header>

        <div className="space-y-6 rounded-2xl border border-border-light bg-surface-secondary p-6 shadow-sm">
          {content ? (
            <div className="prose dark:prose-invert max-w-none text-justify !text-text-primary [&_li]:text-justify [&_p]:text-justify">
              <MarkdownLite content={content} />
            </div>
          ) : (
            <p className="text-base text-text-secondary">
              {localize('com_ui_cookies_policy_unconfigured')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
