import React from 'react';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { TooltipAnchor, LockIcon, Spinner } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

const AnonymizeToggle = ({ disabled }: { disabled?: boolean | null }) => {
  const localize = useLocalize();
  const [anonymizeEnabled, setAnonymizeEnabled] = useRecoilState(store.anonymizeEnabled);
  const phase = useRecoilValue(store.protectionPhase);

  const isBlocking = phase === 'blocked' || phase === 'failed';
  const isAnonymizeDisabled = (disabled ?? false) || isBlocking;

  const getIcon = () => {
    if (phase === 'anonymizing') {
      return <Spinner size={16} color="currentColor" className="animate-pulse" />;
    }
    if (phase === 'protected' || phase === 'streaming') {
      return <ShieldCheck size={16} />;
    }
    if (isBlocking) {
      return <ShieldX size={16} />;
    }
    return <LockIcon />;
  };

  const getColorClass = () => {
    if (phase === 'anonymizing') {
      return 'bg-amber-500/20 text-amber-600 hover:bg-amber-500/30 dark:text-amber-400';
    }
    if (phase === 'protected' || phase === 'streaming') {
      return 'bg-emerald-500/20 text-emerald-600 hover:bg-emerald-500/30 dark:text-emerald-400';
    }
    if (isBlocking) {
      return 'bg-red-500/20 text-red-600 dark:text-red-400 cursor-not-allowed';
    }
    if (anonymizeEnabled) {
      return 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30';
    }
    return 'text-text-secondary';
  };

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
          onClick={() => {
            if (!isBlocking) {
              setAnonymizeEnabled((prev) => !prev);
            }
          }}
          className={cn(
            'flex size-9 items-center justify-center rounded-full p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-opacity-50',
            getColorClass(),
          )}
        >
          <div className="flex w-full items-center justify-center gap-2">{getIcon()}</div>
        </button>
      }
    />
  );
};

export default React.memo(AnonymizeToggle);
