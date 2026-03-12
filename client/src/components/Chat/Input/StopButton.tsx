import { Button } from '@librechat/client';
import { CircleStop } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type StopButtonProps = {
  stop: (e: React.MouseEvent<HTMLButtonElement>) => void;
  setShowStopButton: React.Dispatch<React.SetStateAction<boolean>>;
};

export default function StopButton({ stop, setShowStopButton }: StopButtonProps) {
  const localize = useLocalize();
  const label = localize('com_ui_stop');

  return (
    <Button
      type="button"
      variant="submit"
      className={cn(
        'focus:shadow-outline focus:brand-border flex h-9 w-9 items-center justify-center rounded-full border p-0 font-medium transition-all duration-200 [border-color:var(--sidebar-shell-border)] hover:bg-surface-submit-hover sm:w-auto sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2',
      )}
      aria-label={localize('com_nav_stop_generating')}
      onClick={(e) => {
        setShowStopButton(false);
        stop(e);
      }}
    >
      <span className="hidden sm:inline">{label}</span>
      <CircleStop className="h-4 w-4" />
    </Button>
  );
}
