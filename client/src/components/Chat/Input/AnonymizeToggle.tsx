import React from 'react';
import { useRecoilState } from 'recoil';
import { TooltipAnchor, LockIcon } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

const AnonymizeToggle = ({ disabled }: { disabled?: boolean | null }) => {
  const localize = useLocalize();
  const [anonymizeEnabled, setAnonymizeEnabled] = useRecoilState(store.anonymizeEnabled);
  const isAnonymizeDisabled = disabled ?? false;

  return (
    <TooltipAnchor
      description={localize('Anonymize before sending')}
      id="anonymize-toggle"
      disabled={isAnonymizeDisabled}
      render={
        <button
          type="button"
          data-testid="anonymize-toggle"
          aria-label={localize('Anonymize before sending')}
          disabled={isAnonymizeDisabled}
          onClick={() => setAnonymizeEnabled((prev) => !prev)}
          className={cn(
            'flex size-9 items-center justify-center rounded-full p-1 transition-colors hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50',
            anonymizeEnabled
              ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30'
              : 'text-text-secondary',
          )}
        >
          <div className="flex w-full items-center justify-center gap-2">
            <LockIcon />
          </div>
        </button>
      }
    />
  );
};

export default React.memo(AnonymizeToggle);
