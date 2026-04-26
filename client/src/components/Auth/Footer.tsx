import { useLocalize } from '~/hooks';
import { TStartupConfig } from 'librechat-data-provider';

function Footer({ startupConfig }: { startupConfig: TStartupConfig | null | undefined }) {
  const localize = useLocalize();
  const privacyPolicy = startupConfig?.interface?.privacyPolicy;
  const termsOfService = startupConfig?.interface?.termsOfService;

  const privacyPolicyRender = privacyPolicy?.externalUrl && (
    <a
      className="text-sm text-brand-footer"
      href={privacyPolicy.externalUrl}
      target={privacyPolicy.openNewTab ? '_blank' : undefined}
      rel="noreferrer"
    >
      {localize('com_ui_privacy_policy')}
    </a>
  );

  const termsOfServiceRender = termsOfService?.externalUrl && (
    <a
      className="text-sm text-brand-footer"
      href={termsOfService.externalUrl}
      target={termsOfService.openNewTab ? '_blank' : undefined}
      rel="noreferrer"
    >
      {localize('com_ui_terms_of_service')}
    </a>
  );

  return (
    <div
      className="align-end m-4 flex min-h-5 justify-center gap-2"
      role="contentinfo"
      aria-busy={!startupConfig}
    >
      {privacyPolicyRender}
      {privacyPolicyRender && termsOfServiceRender && (
        <div className="border-r-[1px] border-gray-300 dark:border-gray-600" />
      )}
      {termsOfServiceRender}
    </div>
  );
}

export default Footer;
