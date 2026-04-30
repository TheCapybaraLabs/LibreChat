/* eslint-disable i18next/no-literal-string */
import { useEffect, useMemo, useState } from 'react';
import copy from 'copy-to-clipboard';
import { Button } from '@librechat/client';
import {
  AlertTriangle,
  Check,
  CircleCheckBig,
  Copy,
  FileText,
  Loader2,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '~/utils';

export type PdfPreparationStatus =
  | 'idle'
  | 'extracting'
  | 'chunking'
  | 'anonymizing'
  | 'review'
  | 'ready'
  | 'sending'
  | 'cancelled'
  | 'failed';

export type PdfPreparationState = {
  open: boolean;
  status: PdfPreparationStatus;
  fileName: string;
  fileSize: number;
  fileType?: string;
  pages?: number;
  lines?: number;
  chunkCount?: number;
  entityCount?: number;
  providerSafe?: boolean;
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
  extracting: 'Extraindo texto...',
  chunking: 'Dividindo texto em partes seguras...',
  anonymizing: 'Anonimizando documento...',
  review: 'Pronto para revisão',
  ready: 'Documento anonimizado pronto.',
  sending: 'Enviando texto anonimizado...',
  cancelled: 'Preparação cancelada.',
  failed: 'Falha ao preparar documento.',
};

const progressByStatus: Record<PdfPreparationStatus, number> = {
  idle: 0,
  extracting: 25,
  chunking: 50,
  anonymizing: 75,
  review: 100,
  ready: 100,
  sending: 100,
  cancelled: 0,
  failed: 100,
};

const statusTone: Record<PdfPreparationStatus, string> = {
  idle: 'border-border-light bg-surface-secondary',
  extracting: 'border-border-medium bg-surface-tertiary',
  chunking: 'border-border-medium bg-surface-tertiary',
  anonymizing: 'border-border-medium bg-surface-tertiary',
  review: 'border-border-medium bg-surface-secondary',
  ready: 'border-border-medium bg-surface-secondary',
  sending: 'border-border-medium bg-surface-tertiary',
  cancelled: 'border-border-light bg-surface-secondary',
  failed: 'border-surface-destructive/40 bg-surface-destructive/10',
};

const getStatusMessage = (state: PdfPreparationState, visibleStatus: PdfPreparationStatus) => {
  if (visibleStatus === 'failed') {
    return 'Não foi possível preparar este documento com segurança.';
  }

  if (visibleStatus === 'review' || visibleStatus === 'ready') {
    return 'Documento anonimizado com sucesso. Nenhum conteúdo bruto será enviado.';
  }

  if (visibleStatus === 'anonymizing' && state.chunkCount && state.chunkCount > 1) {
    return `Anonimizando ${state.chunkCount} chunks...`;
  }

  return statusText[visibleStatus];
};

export default function PdfPreparationModal({
  state,
  onCancel,
  onConfirm,
  onRetry,
}: {
  state: PdfPreparationState;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry?: () => void;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const isProcessing =
    state.status === 'extracting' || state.status === 'chunking' || state.status === 'anonymizing';
  const isFailed = state.status === 'failed';
  const isReady = state.status === 'review' || state.status === 'ready';
  const canSend =
    isReady && Boolean(state.providerSafe) && Boolean(state.anonymizedText) && !isSending;
  const visibleStatus = isSending ? 'sending' : state.status;
  const progress = progressByStatus[visibleStatus];
  const sendDisabledReason = state.anonymizedText
    ? 'Aguarde a preparação segura do documento.'
    : 'O envio fica bloqueado até o texto anonimizado estar pronto.';
  const metadata = useMemo(
    () =>
      [
        formatBytes(state.fileSize),
        state.fileType || null,
        state.pages ? `${state.pages} ${state.pages === 1 ? 'página' : 'páginas'}` : null,
        state.lines ? `${state.lines} ${state.lines === 1 ? 'linha' : 'linhas'}` : null,
        state.chunkCount
          ? `${state.chunkCount} ${state.chunkCount === 1 ? 'chunk' : 'chunks'}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    [state.fileSize, state.fileType, state.pages, state.lines, state.chunkCount],
  );

  useEffect(() => {
    if (!state.open) {
      setIsCopied(false);
      setIsSending(false);
    }
  }, [state.open]);

  useEffect(() => {
    if (!isReady) {
      setIsSending(false);
    }
  }, [isReady]);

  const handleCopy = () => {
    if (!state.anonymizedText) {
      return;
    }
    copy(state.anonymizedText, { format: 'text/plain' });
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 2500);
  };

  const handleConfirm = () => {
    if (!canSend) {
      return;
    }
    setIsSending(true);
    onConfirm();
  };

  const renderStatusIcon = () => {
    if (visibleStatus === 'failed') {
      return <AlertTriangle size={16} />;
    }

    if (isProcessing || visibleStatus === 'sending') {
      return <Loader2 size={16} className="animate-spin" />;
    }

    return <Check size={16} />;
  };

  return (
    <DialogPrimitive.Root open={state.open} onOpenChange={(open) => !open && onCancel()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[998] bg-background/70 backdrop-blur-sm transition-all duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in" />
        <DialogPrimitive.Content
          aria-describedby="pdf-preparation-description"
          aria-labelledby="pdf-preparation-title"
          tabIndex={-1}
          className={cn(
            'fixed z-[999] flex max-h-[92vh] flex-col bg-surface-dialog text-text-primary shadow-2xl outline-none',
            'inset-x-0 bottom-0 rounded-t-2xl px-4 pb-5 pt-4',
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(760px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6',
          )}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-light bg-surface-secondary text-text-primary">
                <ShieldCheck size={18} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <DialogPrimitive.Title
                  id="pdf-preparation-title"
                  className="text-lg font-semibold leading-6 text-text-primary"
                >
                  Preparar documento
                </DialogPrimitive.Title>
                <DialogPrimitive.Description
                  id="pdf-preparation-description"
                  className="mt-1 text-sm leading-5 text-text-secondary"
                >
                  O PDF será convertido em texto anonimizado antes de ser enviado ao modelo.
                </DialogPrimitive.Description>
              </div>
            </div>
            <button
              type="button"
              aria-label="Fechar modal de preparação de documento"
              className="rounded-md p-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
              onClick={onCancel}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            <section
              aria-labelledby="pdf-preparation-file-title"
              className="mb-4 rounded-lg border border-border-light bg-surface-secondary p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-light bg-surface-primary text-text-secondary">
                  <FileText size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="pdf-preparation-file-title"
                    className="text-xs font-medium uppercase tracking-wide text-text-secondary"
                  >
                    Arquivo
                  </h3>
                  <p className="mt-1 truncate text-sm font-medium text-text-primary">
                    {state.fileName}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">{metadata}</p>
                </div>
              </div>
            </section>

            <section
              aria-labelledby="pdf-preparation-status-title"
              className={cn('mb-4 rounded-lg border p-4', statusTone[visibleStatus])}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 id="pdf-preparation-status-title" className="text-sm font-semibold">
                    Status de segurança
                  </h3>
                  <p
                    className="mt-1 text-sm text-text-secondary"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {getStatusMessage(state, visibleStatus)}
                  </p>
                </div>
                <div
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full border border-border-light bg-surface-primary',
                    visibleStatus === 'failed' && 'border-surface-destructive/40',
                  )}
                  aria-hidden="true"
                >
                  {renderStatusIcon()}
                </div>
              </div>

              <div
                className="mt-4 h-2 overflow-hidden rounded-full bg-surface-hover"
                aria-label={`Progresso da preparação: ${progress}%`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div
                  className={cn(
                    'h-full rounded-full bg-primary transition-all duration-300',
                    isReady && 'bg-surface-submit',
                    visibleStatus === 'failed' && 'bg-surface-destructive',
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                {[
                  { label: 'Texto extraído', complete: progress >= 25 && !isFailed },
                  { label: 'Anonimização concluída', complete: progress >= 100 && !isFailed },
                  {
                    label: state.providerSafe
                      ? 'providerSafe confirmado'
                      : 'Conteúdo seguro para envio',
                    complete: isReady && Boolean(state.providerSafe) && !isSending,
                  },
                ].map((step) => (
                  <div key={step.label} className="flex items-center gap-2 text-text-secondary">
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border border-border-light bg-surface-primary',
                        step.complete &&
                          'border-surface-submit bg-surface-submit text-primary-foreground',
                      )}
                      aria-hidden="true"
                    >
                      {step.complete ? (
                        <Check size={13} />
                      ) : (
                        <span className="size-1.5 rounded-full bg-current" />
                      )}
                    </span>
                    <span>{step.label}</span>
                  </div>
                ))}
              </div>

              {isFailed && (
                <p className="border-surface-destructive/30 mt-4 rounded-md border bg-surface-primary p-3 text-sm text-text-secondary">
                  O envio foi bloqueado para evitar exposição de dados brutos.
                </p>
              )}
              {isReady && (
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-text-secondary">
                  <span className="rounded-full border border-border-light bg-surface-primary px-2 py-1">
                    {state.entityCount ?? 0} entidades
                  </span>
                  <span className="rounded-full border border-border-light bg-surface-primary px-2 py-1">
                    providerSafe={state.providerSafe ? 'true' : 'false'}
                  </span>
                </div>
              )}
            </section>

            {state.anonymizedText && !isFailed && (
              <section aria-labelledby="pdf-preparation-preview-title" className="mb-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 id="pdf-preparation-preview-title" className="text-sm font-semibold">
                      Preview anonimizado
                    </h3>
                    <p className="mt-1 text-sm text-text-secondary">
                      Revise o conteúdo que será enviado ao modelo.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 rounded-md px-2.5"
                    aria-label={isCopied ? 'Texto anonimizado copiado' : 'Copiar texto anonimizado'}
                    onClick={handleCopy}
                  >
                    {isCopied ? (
                      <CircleCheckBig size={15} aria-hidden="true" />
                    ) : (
                      <Copy size={15} aria-hidden="true" />
                    )}
                    <span>{isCopied ? 'Copiado' : 'Copiar texto'}</span>
                  </Button>
                </div>
                <pre className="max-h-[42vh] min-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border-light bg-surface-secondary p-5 font-mono text-sm leading-6 text-text-primary shadow-inner">
                  {state.anonymizedText}
                </pre>
              </section>
            )}
          </div>

          <div className="mt-1 flex flex-col-reverse gap-2 border-t border-border-light pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              className="h-10 rounded-md text-text-secondary hover:text-text-primary"
              onClick={onCancel}
            >
              Cancelar
            </Button>
            {isFailed ? (
              <Button
                type="button"
                variant="submit"
                className="h-10 rounded-md"
                aria-label="Tentar preparar o documento novamente"
                onClick={onRetry ?? onCancel}
              >
                Tentar novamente
              </Button>
            ) : (
              <div className="flex flex-col items-stretch gap-1 sm:items-end">
                <Button
                  type="button"
                  variant="submit"
                  className="h-10 rounded-md disabled:opacity-70"
                  disabled={!canSend}
                  aria-label="Usar texto anonimizado"
                  aria-describedby={!canSend ? 'pdf-preparation-send-disabled' : undefined}
                  title={!canSend ? sendDisabledReason : undefined}
                  onClick={handleConfirm}
                >
                  {isSending ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Send size={16} aria-hidden="true" />
                  )}
                  {isSending ? 'Enviando...' : 'Usar texto anonimizado'}
                </Button>
                {!canSend && (
                  <span id="pdf-preparation-send-disabled" className="text-xs text-text-secondary">
                    {sendDisabledReason}
                  </span>
                )}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
