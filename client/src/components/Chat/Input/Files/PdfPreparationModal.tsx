/* eslint-disable i18next/no-literal-string */
import { useEffect, useMemo, useState } from 'react';
import copy from 'copy-to-clipboard';
import { Button } from '@librechat/client';
import {
  AlertTriangle,
  Check,
  CircleCheckBig,
  Copy,
  Download,
  FileText,
  Loader2,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';

export type PdfPreparationStatus =
  | 'idle'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'ocr'
  | 'chunking'
  | 'anonymization'
  | 'rebuilding'
  | 'completed'
  | 'review'
  | 'review_required'
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
  reviewRequired?: boolean;
  requestId?: string;
  jobId?: string;
  processingStatus?: string;
  processingStage?: string;
  blurryMessage?: string;
  progress?: number;
  estimatedSeconds?: number;
  elapsedMs?: number;
  ocrActive?: boolean;
  errorCode?: string;
  errorStage?: string;
  pagesProcessed?: number;
  chunksProcessed?: number;
  anonymizedText?: string;
  sanitizedDownloadUrl?: string;
  sanitizedDocxDownloadUrl?: string;
  sanitizedFileName?: string;
  availableArtifacts?: {
    sanitizedPdf: boolean;
    sanitizedDocx: boolean;
    sanitizedText: boolean;
  };
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
  uploading: 'Enviando arquivo para processamento seguro...',
  queued: 'Documento na fila de processamento...',
  processing: 'Processando documento com segurança...',
  ocr: 'Executando OCR...',
  chunking: 'Dividindo texto em partes seguras...',
  anonymization: 'Anonimizando documento...',
  rebuilding: 'Gerando arquivo anonimizado...',
  completed: 'Documento processado com sucesso.',
  review: 'Pronto para revisão',
  review_required: 'Revisão recomendada — conteúdo anonimizado disponível com aviso',
  sending: 'Enviando texto anonimizado...',
  cancelled: 'Preparação cancelada.',
  failed: 'Falha ao preparar documento.',
};

const progressByStatus: Record<PdfPreparationStatus, number> = {
  idle: 0,
  uploading: 10,
  queued: 15,
  processing: 35,
  ocr: 55,
  chunking: 70,
  anonymization: 80,
  rebuilding: 90,
  completed: 100,
  review: 100,
  review_required: 100,
  sending: 100,
  cancelled: 0,
  failed: 100,
};

const statusTone: Record<PdfPreparationStatus, string> = {
  idle: 'border-border-light bg-surface-secondary',
  uploading: 'border-border-medium bg-surface-tertiary',
  queued: 'border-border-medium bg-surface-tertiary',
  processing: 'border-border-medium bg-surface-tertiary',
  ocr: 'border-border-medium bg-surface-tertiary',
  chunking: 'border-border-medium bg-surface-tertiary',
  anonymization: 'border-border-medium bg-surface-tertiary',
  rebuilding: 'border-border-medium bg-surface-tertiary',
  completed: 'border-border-medium bg-surface-secondary',
  review: 'border-border-medium bg-surface-secondary',
  review_required: 'border-yellow-400/60 bg-yellow-50/10',
  sending: 'border-border-medium bg-surface-tertiary',
  cancelled: 'border-border-light bg-surface-secondary',
  failed: 'border-surface-destructive/40 bg-surface-destructive/10',
};

const formatElapsedMs = (ms?: number): string | null => {
  if (typeof ms !== 'number' || ms <= 0) {
    return null;
  }
  if (ms < 60000) {
    return `${Math.round(ms / 1000)}s`;
  }
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m${sec > 0 ? ` ${sec}s` : ''}`;
};

const getStatusMessage = (state: PdfPreparationState, visibleStatus: PdfPreparationStatus) => {
  if (visibleStatus === 'failed') {
    return state.error || 'Não foi possível preparar este documento com segurança.';
  }

  if (visibleStatus === 'review_required') {
    return 'Documento anonimizado com aviso de revisão. Verifique o conteúdo antes de enviar.';
  }

  if (visibleStatus === 'review' || visibleStatus === 'completed') {
    return 'Documento anonimizado com sucesso. Nenhum conteúdo bruto será enviado.';
  }

  if (visibleStatus === 'ocr') {
    if (state.pagesProcessed && state.pages) {
      return `OCR da página ${state.pagesProcessed} de ${state.pages}`;
    }
    if (state.pages) {
      return `Executando OCR (${state.pages} ${state.pages === 1 ? 'página' : 'páginas'})`;
    }
  }

  if (visibleStatus === 'anonymization') {
    if (state.chunksProcessed && state.chunkCount) {
      return `Anonimizando chunk ${state.chunksProcessed} de ${state.chunkCount}`;
    }
  }

  if (visibleStatus === 'rebuilding') {
    return 'Gerando arquivo anonimizado...';
  }

  // Prefer the message from Blurry API when available
  if (state.blurryMessage) {
    const elapsed = formatElapsedMs(state.elapsedMs);
    return elapsed ? `${state.blurryMessage} (${elapsed})` : state.blurryMessage;
  }

  const elapsed = formatElapsedMs(state.elapsedMs);
  const base = statusText[visibleStatus];
  return elapsed ? `${base} (${elapsed})` : base;
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
  const { token } = useAuthContext();
  const [isCopied, setIsCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const isProcessing =
    state.status === 'uploading' ||
    state.status === 'queued' ||
    state.status === 'processing' ||
    state.status === 'ocr' ||
    state.status === 'chunking' ||
    state.status === 'anonymization' ||
    state.status === 'rebuilding';
  const isFailed = state.status === 'failed';
  const isReviewRequired = state.status === 'review_required';
  const isReady = state.status === 'review' || state.status === 'completed' || isReviewRequired;
  const canSend =
    isReady && Boolean(state.providerSafe) && Boolean(state.anonymizedText) && !isSending;
  const visibleStatus = isSending ? 'sending' : state.status;
  const progressFromServer =
    typeof state.progress === 'number' && Number.isFinite(state.progress)
      ? Math.max(0, Math.min(100, state.progress > 1 ? Math.round(state.progress) : Math.round(state.progress * 100)))
      : null;
  const progress = progressFromServer ?? progressByStatus[visibleStatus];
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
        state.processingStatus ? `status: ${state.processingStatus}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    [
      state.fileSize,
      state.fileType,
      state.pages,
      state.lines,
      state.chunkCount,
      state.processingStatus,
    ],
  );

  useEffect(() => {
    if (!state.open) {
      setIsCopied(false);
      setIsSending(false);
      setIsDownloading(false);
      setDownloadError(null);
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

  const handleDownload = async (artifactType: 'pdf' | 'docx' | 'text') => {
    const downloadUrl =
      artifactType === 'docx'
        ? state.sanitizedDocxDownloadUrl
        : artifactType === 'text'
          ? state.jobId
            ? `/api/files/prepare-file/jobs/${encodeURIComponent(state.jobId)}/download?type=text`
            : undefined
          : state.sanitizedDownloadUrl;

    if (!downloadUrl || isDownloading) {
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);

    console.info('[file-preparation-download]', {
      stage: 'download_started',
      jobId: state.jobId,
      downloadUrl,
      hasToken: !!token,
      hasProviderSafe: state.providerSafe,
      artifactType,
    });

    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(downloadUrl, { credentials: 'include', headers });

      if (!response.ok) {
        let code = 'BLURRY_DOWNLOAD_FAILED';
        if (response.status === 404) {
          code = 'ARTIFACT_NOT_FOUND';
        } else if (response.status === 410) {
          code = 'ARTIFACT_EXPIRED';
        } else if (response.status === 401 || response.status === 403) {
          code = 'BLURRY_DOWNLOAD_UNAUTHORIZED';
        } else if (response.status === 409) {
          code = 'BLURRY_JOB_NOT_READY';
        }
        console.error('[file-preparation-download]', {
          stage: 'download_failed',
          jobId: state.jobId,
          status: response.status,
          contentType: response.headers.get('content-type'),
          code,
        });
        const err = new Error(`Download falhou: ${response.status}`) as Error & { code?: string };
        err.code = code;
        throw err;
      }

      const contentType = response.headers.get('content-type') || 'application/pdf';
      const disposition = response.headers.get('content-disposition') || '';

      console.info('[file-preparation-download]', {
        stage: 'download_completed',
        jobId: state.jobId,
        status: response.status,
        contentType,
        contentLength: response.headers.get('content-length'),
      });

      const defaultFilename =
        artifactType === 'docx'
          ? 'documento.anonimizado.docx'
          : artifactType === 'text'
            ? 'documento.anonimizado.txt'
            : 'documento.anonimizado.pdf';
      let filename = defaultFilename;
      const filenameMatch = disposition.match(/filename[^;=\n]*=(['"]?)([^;\n'"]+)\1/);
      if (filenameMatch?.[2]) {
        filename = filenameMatch[2].trim();
      } else if (state.sanitizedFileName) {
        filename = state.sanitizedFileName;
      }

      const arrayBuffer = await response.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const code = (err as Error & { code?: string }).code || 'BLURRY_DOWNLOAD_FAILED';
      setDownloadError(code);
    } finally {
      setIsDownloading(false);
    }
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
                    <span className="break-words">{step.label}</span>
                  </div>
                ))}
              </div>

              {isFailed && (
                <div className="border-surface-destructive/30 mt-4 rounded-md border bg-surface-primary p-3 text-sm text-text-secondary">
                  <p>O envio foi bloqueado para evitar exposição de dados brutos.</p>
                  {(state.errorCode || state.errorStage || state.requestId) && (
                    <p className="mt-2 text-xs">
                      {[state.errorCode, state.errorStage, state.requestId]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              )}
              {isReviewRequired && (
                <div className="mt-4 rounded-md border border-yellow-400/40 bg-yellow-50/10 p-3 text-sm text-text-secondary">
                  <p className="font-medium">
                    Aviso: documento requer revisão manual no serviço de anonimização.
                  </p>
                  <p className="mt-1">
                    O conteúdo foi anonimizado mas pode conter achados pendentes de revisão. Revise o
                    texto abaixo antes de enviar ao modelo.
                  </p>
                  {state.jobId && (
                    <p className="mt-2 text-xs opacity-70">
                      jobId: {state.jobId}
                    </p>
                  )}
                </div>
              )}
              {isReady && (
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-text-secondary">
                  <span className="rounded-full border border-border-light bg-surface-primary px-2 py-1">
                    {state.entityCount ?? 0} entidades
                  </span>
                  <span className="rounded-full border border-border-light bg-surface-primary px-2 py-1">
                    providerSafe={state.providerSafe ? 'true' : 'false'}
                  </span>
                  {typeof state.estimatedSeconds === 'number' && state.estimatedSeconds > 0 && (
                    <span className="rounded-full border border-border-light bg-surface-primary px-2 py-1">
                      ETA ~{state.estimatedSeconds}s
                    </span>
                  )}
                  {state.ocrActive && (
                    <span className="rounded-full border border-border-light bg-surface-primary px-2 py-1">
                      OCR ativo
                    </span>
                  )}
                  {state.sanitizedDownloadUrl && (
                    <span className="rounded-full border border-border-light bg-surface-primary px-2 py-1">
                      Arquivo anonimizado disponível para download
                    </span>
                  )}
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
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  {state.sanitizedDownloadUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-md"
                      disabled={isDownloading}
                      aria-label="Baixar PDF anonimizado"
                      onClick={() => handleDownload('pdf')}
                    >
                      {isDownloading ? (
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Download size={16} aria-hidden="true" />
                      )}
                      {isDownloading ? 'Baixando...' : 'Baixar PDF anonimizado'}
                    </Button>
                  )}
                  {state.sanitizedDocxDownloadUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-md"
                      disabled={isDownloading}
                      aria-label="Baixar DOCX anonimizado"
                      onClick={() => handleDownload('docx')}
                    >
                      {isDownloading ? (
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Download size={16} aria-hidden="true" />
                      )}
                      {isDownloading ? 'Baixando...' : 'Baixar DOCX anonimizado'}
                    </Button>
                  )}
                  {!state.sanitizedDownloadUrl &&
                    !state.sanitizedDocxDownloadUrl &&
                    state.availableArtifacts?.sanitizedText &&
                    isReady && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-md"
                        disabled={isDownloading}
                        aria-label="Baixar TXT anonimizado"
                        onClick={() => handleDownload('text')}
                      >
                        {isDownloading ? (
                          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Download size={16} aria-hidden="true" />
                        )}
                        {isDownloading ? 'Baixando...' : 'Baixar TXT anonimizado'}
                      </Button>
                    )}
                  <Button
                    type="button"
                    variant="submit"
                    className="h-10 rounded-md disabled:opacity-70"
                    disabled={!canSend}
                    aria-label="Enviar texto anonimizado"
                    aria-describedby={!canSend ? 'pdf-preparation-send-disabled' : undefined}
                    title={!canSend ? sendDisabledReason : undefined}
                    onClick={handleConfirm}
                  >
                    {isSending ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Send size={16} aria-hidden="true" />
                    )}
                    {isSending ? 'Enviando...' : 'Enviar texto anonimizado'}
                  </Button>
                </div>
                {downloadError && (
                  <span className="text-xs text-red-500" role="alert">
                    {downloadError === 'ARTIFACT_NOT_FOUND'
                      ? 'Arquivo anonimizado não encontrado.'
                      : downloadError === 'ARTIFACT_EXPIRED'
                        ? 'O arquivo anonimizado expirou. Reprocesse o documento.'
                        : downloadError === 'BLURRY_DOWNLOAD_UNAUTHORIZED'
                          ? 'Sem autorização para baixar. Faça login novamente.'
                          : downloadError === 'BLURRY_JOB_NOT_READY'
                            ? 'O documento ainda não está pronto para download.'
                            : 'Falha ao baixar o arquivo anonimizado.'}
                  </span>
                )}
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
