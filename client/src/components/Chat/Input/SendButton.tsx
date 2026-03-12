import React, { forwardRef } from 'react';
import { useWatch } from 'react-hook-form';
import type { Control } from 'react-hook-form';
import { Button } from '@librechat/client';
import { CircleArrowUp } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SendButtonProps = {
  disabled: boolean;
  control: Control<{ text: string }>;
};

const SubmitButton = React.memo(
  forwardRef((props: { disabled: boolean }, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const localize = useLocalize();
    const label = localize('com_ui_submit');

    return (
      <Button
        ref={ref}
        variant="submit"
        aria-label={label}
        id="send-button"
        disabled={props.disabled}
        className={cn(
          'focus:shadow-outline focus:brand-border flex h-9 w-9 items-center justify-center rounded-full border p-0 font-medium transition-all duration-200 [border-color:var(--sidebar-shell-border)] hover:bg-surface-submit-hover sm:w-auto sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2',
        )}
        data-testid="send-button"
        type="submit"
      >
        <span className="hidden sm:inline">{label}</span>
        <CircleArrowUp className="h-4 w-4" />
      </Button>
    );
  }),
);

const SendButton = React.memo(
  forwardRef((props: SendButtonProps, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const data = useWatch({ control: props.control });
    return <SubmitButton ref={ref} disabled={props.disabled || !data.text?.trim()} />;
  }),
);

export default SendButton;
