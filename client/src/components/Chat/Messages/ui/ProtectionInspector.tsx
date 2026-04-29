import { memo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '~/utils';
import store from '~/store';

// --- ProtectionBadge ---

interface ProtectionBadgeProps {
  messageId: string;
}

export const ProtectionBadge = memo(({ messageId }: ProtectionBadgeProps) => {
  const [open, setOpen] = useState(false);
  const map = useRecoilValue(store.sessionProtectionMap);
  const meta = map[messageId];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Ver detalhes de proteção"
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
            'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
            'text-[10px] font-medium transition-colors hover:bg-emerald-500/25',
            'focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1',
          )}
        >
          <ShieldCheck size={10} />
          {meta ? `${meta.entityCount} protegido${meta.entityCount !== 1 ? 's' : ''}` : 'Anonimizado'}
        </button>
      </DialogPrimitive.Trigger>

      <ProtectionInspectorContent meta={meta} onClose={() => setOpen(false)} />
    </DialogPrimitive.Root>
  );
});

ProtectionBadge.displayName = 'ProtectionBadge';

// --- Inspector Content ---

interface InspectorContentProps {
  meta?: { entityCount: number; entityTypes: string[]; processingMs?: number };
  onClose: () => void;
}

const ENTITY_LABELS: Record<string, string> = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  NAME: 'Nome',
  DATE: 'Data',
  ADDRESS: 'Endereço',
  IP: 'IP',
  CREDIT_CARD: 'Cartão',
  RG: 'RG',
};

const ProtectionInspectorContent = memo(({ meta, onClose }: InspectorContentProps) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
    <DialogPrimitive.Content
      className={cn(
        'fixed z-[999] bg-surface-primary shadow-xl outline-none',
        // Mobile: bottom sheet
        'inset-x-0 bottom-0 rounded-t-3xl px-5 pb-8 pt-4',
        // Desktop: centered card
        'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2',
        'sm:w-[380px] sm:rounded-2xl sm:px-6 sm:py-5',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in',
      )}
    >
      {/* Drag handle (mobile) */}
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-medium sm:hidden" />

      {/* Header */}
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck size={18} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Proteção aplicada</h2>
          <p className="text-xs text-text-secondary">
            {meta
              ? `${meta.entityCount} dado${meta.entityCount !== 1 ? 's' : ''} substituído${meta.entityCount !== 1 ? 's' : ''}`
              : 'Texto anonimizado antes do envio'}
          </p>
        </div>
      </div>

      {/* Entity chips */}
      {meta && meta.entityTypes.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
            Categorias protegidas
          </p>
          <div className="flex flex-wrap gap-1.5">
            {meta.entityTypes.map((type) => (
              <span
                key={type}
                className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-text-primary"
              >
                {ENTITY_LABELS[type] ?? type}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Processing time */}
      {meta?.processingMs != null && (
        <p className="mb-4 text-xs text-text-secondary">
          Processado em {meta.processingMs}ms pela Blurry
        </p>
      )}

      {/* Footer note */}
      <p className="mb-4 rounded-xl bg-surface-hover px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
        O texto original foi substituído antes de chegar ao modelo de linguagem.
      </p>

      <DialogPrimitive.Close asChild>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-surface-hover py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover-alt focus:outline-none"
        >
          Fechar
        </button>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));

ProtectionInspectorContent.displayName = 'ProtectionInspectorContent';

export default ProtectionBadge;
