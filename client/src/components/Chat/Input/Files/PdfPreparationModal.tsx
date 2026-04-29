/* eslint-disable i18next/no-literal-string */
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '~/utils';

export type PdfPreparationStatus =
  | 'idle'
  | 'extracting'
  | 'chunking'
  | 'anonymizing'
  | 'review'
  | 'ready'
  | 'failed';

export type PdfPreparationState = {
  open: boolean;
  status: PdfPreparationStatus;
  fileName: string;
  fileSize: number;
  pages?: number;
  chunkCount?: number;
  anonymizedText?: string;
  error?: string;
};

const formatBytes = (bytes: number) => {
  if (!bytes) {
    return '0 KB';
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${Math.ceil(bytes / 1024)} KB`;
};

const statusText: Record<PdfPreparationStatus, string> = {
  idle: 'Preparar documento',
  extracting: 'Extraindo texto do PDF.',
  chunking: 'Dividindo texto em partes seguras.',
  anonymizing: 'Anonimizando partes do documento.',
  review: 'Revise o texto anonimizado.',
  ready: 'Documento anonimizado pronto.',
  failed: 'Falha ao preparar documento.',
};

export default function PdfPreparationModal({
  state,
  onCancel,
  onConfirm,
}: {
  state: PdfPreparationState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isProcessing =
    state.status === 'extracting' || state.status === 'chunking' || state.status === 'anonymizing';
  const canSend =
    (state.status === 'review' || state.status === 'ready') && Boolean(state.anonymizedText);

  return (
    <DialogPrimitive.Root open={state.open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[998] bg-black/40" />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-[999] bg-surface-primary text-text-primary shadow-xl outline-none',
            'inset-x-0 bottom-0 rounded-t-2xl px-5 pb-6 pt-4',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[560px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-5',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Preparar documento</h2>
              <p className="mt-1 text-sm text-text-secondary">
                O conteúdo bruto não será enviado ao modelo.
              </p>
            </div>
            <button
              type="button"
              aria-label="Cancelar preparação"
              className="rounded-md p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              onClick={onCancel}
            >
              <X size={18} />
            </button>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-text-secondary">Arquivo</p>
              <p className="truncate font-medium">{state.fileName}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Tamanho</p>
              <p className="font-medium">{formatBytes(state.fileSize)}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Páginas</p>
              <p className="font-medium">{state.pages ?? '-'}</p>
            </div>
            <div>
              <p className="text-xs text-text-secondary">Chunks</p>
              <p className="font-medium">{state.chunkCount ?? '-'}</p>
            </div>
          </div>

          <div className="mb-4 rounded-md border border-border-light bg-surface-secondary p-3">
            <p className="text-sm font-medium">
              {isProcessing ? 'Preparando documento com segurança...' : statusText[state.status]}
            </p>
            <p className="mt-1 text-sm text-text-secondary">{statusText[state.status]}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-hover">
              <div
                className={cn(
                  'h-full bg-emerald-500 transition-all',
                  state.status === 'extracting' && 'w-1/4',
                  state.status === 'chunking' && 'w-1/2',
                  state.status === 'anonymizing' && 'w-3/4',
                  (state.status === 'review' || state.status === 'ready') && 'w-full',
                  state.status === 'failed' && 'w-full bg-red-500',
                )}
              />
            </div>
          </div>

          {state.error && (
            <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
              {state.error}
            </p>
          )}

          {state.anonymizedText && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium uppercase text-text-secondary">
                Preview anonimizado
              </p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border-light bg-surface-secondary p-3 text-xs leading-relaxed">
                {state.anonymizedText}
              </pre>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover"
              onClick={onCancel}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSend}
              onClick={onConfirm}
            >
              Enviar anonimizado
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
