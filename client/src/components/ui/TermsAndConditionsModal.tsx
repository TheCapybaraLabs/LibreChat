import { useMemo, useState } from 'react';
import { OGDialog, DialogTemplate, useToastContext } from '@librechat/client';
import type { TTermsOfService } from 'librechat-data-provider';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { useAcceptTermsMutation, useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

const TermsAndConditionsModal = ({
  open,
  onOpenChange,
  onAccept,
  onDecline,
  title,
  modalContent,
}: {
  open: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onAccept: () => void;
  onDecline: () => void;
  title?: string;
  contentUrl?: string;
  modalContent?: TTermsOfService['modalContent'];
}) => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: startupConfig } = useGetStartupConfig();
  const cookiesPolicy = startupConfig?.interface?.cookiesPolicy;
  const cookiesPolicyHref = cookiesPolicy?.externalUrl ?? '/cookies';
  const cookiesRequiresConsent = cookiesPolicy != null;
  const cookiesLinkLabel = cookiesPolicy?.modalTitle ?? localize('com_ui_cookies_policy');

  const acceptTermsMutation = useAcceptTermsMutation({
    onSuccess: () => {
      onAccept();
      onOpenChange(false);
    },
    onError: () => {
      showToast({ message: localize('com_ui_terms_accept_error') });
    },
  });

  const [cookiesPolicyState, setCookiesPolicyState] = useState(false);

  const handleAccept = () => {
    acceptTermsMutation.mutate();
  };

  const handleDecline = () => {
    onDecline();
    onOpenChange(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (open && !isOpen) {
      return;
    }
    onOpenChange(isOpen);
  };

  const content = useMemo(() => {
    if (typeof modalContent === 'string') {
      return modalContent;
    }

    if (Array.isArray(modalContent)) {
      return modalContent.join('\n');
    }

    return '';
  }, [modalContent]);

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <DialogTemplate
        title={title ?? localize('com_ui_terms_and_conditions')}
        className="w-11/12 max-w-3xl sm:w-3/4 md:w-1/2 lg:w-2/5"
        showCloseButton={false}
        showCancelButton={false}
        main={
          <section
            // Motivation: This is a dialog, so its content should be focusable

            tabIndex={0}
            className="max-h-[60vh] overflow-y-auto p-4"
            aria-label={localize('com_ui_terms_and_conditions')}
          >
            <div className="prose dark:prose-invert w-full max-w-none !text-text-primary">
              {content !== '' ? (
                <MarkdownLite content={content} />
              ) : (
                <p>{localize('com_ui_no_terms_content')}</p>
              )}
            </div>
          </section>
        }
        buttons={
          <div className="flex gap-2 whitespace-nowrap">
            <button
              onClick={handleDecline}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border-heavy bg-surface-secondary px-4 py-2 text-sm text-text-primary hover:bg-surface-active"
            >
              {localize('com_ui_decline')}
            </button>
            <button
              disabled={cookiesRequiresConsent && !cookiesPolicyState}
              onClick={handleAccept}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border-heavy bg-surface-secondary px-4 py-2 text-sm text-text-primary hover:bg-brand-bg hover:text-white focus:bg-brand-bg focus:text-white disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-brand-bg dark:focus:bg-brand-bg"
            >
              {localize('com_ui_accept')}
            </button>
          </div>
        }
        leftButtons={
          cookiesRequiresConsent ? (
            <label
              htmlFor="cookies-policy"
              className="flex items-start gap-2 text-sm text-text-primary"
            >
              <input
                type="checkbox"
                id="cookies-policy"
                name="cookies-policy"
                value="true"
                className="mt-0.5 h-4 w-4 rounded border-border-medium"
                checked={cookiesPolicyState}
                onChange={(e) => setCookiesPolicyState(e.target.checked)}
              />
              <span className="text-text-primary">
                {localize('com_ui_cookies_consent_label')}{' '}
                <a
                  href={cookiesPolicyHref}
                  target={cookiesPolicy?.openNewTab === true ? '_blank' : undefined}
                  rel="noreferrer"
                  className="text-blue-600 underline hover:text-blue-800"
                >
                  {cookiesLinkLabel}
                </a>
                .
              </span>
            </label>
          ) : null
        }
      />
    </OGDialog>
  );
};

export default TermsAndConditionsModal;
