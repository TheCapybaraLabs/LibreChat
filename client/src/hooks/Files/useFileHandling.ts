import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { v4 } from 'uuid';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import {
  QueryKeys,
  Constants,
  dataService,
  EToolResources,
  mergeFileConfig,
  isAssistantsEndpoint,
  getEndpointFileConfig,
  defaultAssistantsVersion,
} from 'librechat-data-provider';
import debounce from 'lodash/debounce';
import type { TEndpointsConfig, TError } from 'librechat-data-provider';
import type { ExtendedFile, FileSetter } from '~/common';
import { useGetFileConfig, useUploadFileMutation } from '~/data-provider';
import useLocalize, { TranslationKeys } from '~/hooks/useLocalize';
import { useDelayedUploadToast } from './useDelayedUploadToast';
import { processFileForUpload } from '~/utils/heicConverter';
import { useChatContext } from '~/Providers/ChatContext';
import { ephemeralAgentByConvoId } from '~/store';
import { logger, validateFiles } from '~/utils';
import useClientResize from './useClientResize';
import useUpdateFiles from './useUpdateFiles';
import store from '~/store';
import type { PdfPreparationState } from '~/components/Chat/Input/Files/PdfPreparationModal';

type UseFileHandling = {
  fileSetter?: FileSetter;
  fileFilter?: (file: File) => boolean;
  additionalMetadata?: Record<string, string | undefined>;
  onPreparedPdfConfirm?: (payload: { filename: string; anonymizedText: string }) => void;
};

type PreparedPdfResponse = {
  ok?: boolean;
  requestId?: string;
  jobId?: string;
  status?: string;
  providerSafe?: boolean;
  processingStage?: string;
};

type PreparationErrorResponse = {
  message?: string;
  errorCode?: string;
  stage?: string;
  requestId?: string;
  fileType?: string;
  fileSize?: number;
  pages?: number;
  chunksTotal?: number;
  chunkIndex?: number;
  status?: string;
};

type BlurryCapabilities = {
  documents?: {
    enabled?: boolean;
    maxFileMb?: number;
    allowedMime?: string[];
    ocrEnabled?: boolean;
  };
  anonymize?: {
    enabled?: boolean;
    maxTextChars?: number;
  };
};

type PreparedPdfJobResponse = {
  ok?: boolean;
  requestId?: string;
  jobId?: string;
  status?: string;
  providerSafe?: boolean;
  processingStage?: string;
  message?: string;
  progress?: number;
  estimatedSeconds?: number;
  elapsedMs?: number;
  ocrActive?: boolean;
  pagesTotal?: number;
  pagesProcessed?: number;
  chunksTotal?: number;
  chunksProcessed?: number;
  outputs?: {
    sanitizedPdfUrl?: string;
    sanitizedDocxUrl?: string;
    sanitizedFileName?: string;
    sanitizedTextAvailable?: boolean;
    sanitizedPdf?: boolean;
    sanitizedDocx?: boolean;
  };
  errorCode?: string;
};

type PreparedPdfTextDownload = {
  ok?: boolean;
  text?: string;
};

const preparationErrorMessages: Record<string, string> = {
  OCR_FAILED: 'Falha ao executar OCR no documento.',
  TEXT_TOO_LARGE: 'O texto anonimizado ultrapassou o limite suportado.',
  CHUNK_FAILED: 'Falha ao processar chunks do documento.',
  TIMEOUT: 'O processamento do documento excedeu o tempo limite.',
  BLURRY_JOB_TIMEOUT: 'O processamento do documento excedeu o tempo limite.',
  PDF_TEXT_EXTRACTION_FAILED: 'Não foi possível extrair texto deste PDF.',
  PDF_NO_SELECTABLE_TEXT: 'Este PDF não possui texto selecionável.',
  BLURRY_ANONYMIZE_FAILED: 'A anonimização falhou em uma parte do documento.',
  BLURRY_TIMEOUT: 'O serviço de anonimização demorou mais que o esperado.',
  INVALID_ANONYMIZE_RESPONSE: 'A resposta de anonimização veio inválida.',
  SANITIZED_TEXT_MISSING: 'O texto anonimizado não está disponível. O envio foi bloqueado.',
  BLURRY_TEXT_OUTPUT_MISSING: 'O texto anonimizado não está disponível. O envio foi bloqueado.',
  PROVIDER_SAFE_MISSING: 'O documento não foi marcado como seguro pelo provedor.',
  BLURRY_PROVIDER_UNSAFE: 'O documento não foi validado como seguro pelo provedor. O envio foi bloqueado.',
  BLURRY_STATUS_UNAVAILABLE: 'Não foi possível consultar o status do processamento.',
  BLURRY_JOB_FAILED: 'O processamento do documento falhou no serviço de anonimização.',
  BLURRY_DOCUMENT_UPLOAD_FAILED: 'Falha ao enviar o documento para processamento seguro.',
  BLURRY_DOWNLOAD_FAILED: 'Não foi possível baixar o texto anonimizado.',
  BLURRY_CAPABILITIES_UNAVAILABLE: 'Serviço de documentos indisponível no momento.',
  TEXT_DOWNLOAD_FAILED: 'Não foi possível baixar o texto anonimizado.',
  REVIEW_REQUIRED: 'O documento requer revisão manual e não pode ser enviado automaticamente.',
  DOCUMENTS_DISABLED: 'O serviço de documentos não está disponível no momento.',
};

const PREPARE_POLL_INITIAL_INTERVAL_MS = 2000;
const PREPARE_POLL_MAX_INTERVAL_MS = Number(process.env.REACT_APP_PREPARE_POLL_MAX_MS) || 10000;
const PREPARE_POLL_TIMEOUT_MS = Number(process.env.REACT_APP_PREPARE_POLL_TIMEOUT_MS) || 180000;
const PREPARE_POLL_MAX_RETRIES = 3;
const BLURRY_CAPABILITIES_CACHE_TTL_MS = 5 * 60 * 1000;

const logPreparationTrace = (trace: {
  stage: string;
  errorCode?: string;
  fileType?: string;
  fileSize?: number;
  pages?: number;
  chunksTotal?: number;
  chunkIndex?: number;
  status?: string;
  requestId?: string;
}) => {
  // Never log raw text, OCR output, chunks, or entity values
  console.debug('[file-preparation]', {
    stage: trace.stage,
    errorCode: trace.errorCode,
    fileType: trace.fileType,
    fileSize: trace.fileSize,
    pages: trace.pages,
    chunksTotal: trace.chunksTotal,
    chunkIndex: trace.chunkIndex,
    status: trace.status,
    requestId: trace.requestId,
  });
};

const useFileHandling = (params?: UseFileHandling) => {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const [errors, setErrors] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { startUploadTimer, clearUploadTimer } = useDelayedUploadToast();
  const { files, setFiles, setFilesLoading, conversation } = useChatContext();
  const setEphemeralAgent = useSetRecoilState(
    ephemeralAgentByConvoId(conversation?.conversationId ?? Constants.NEW_CONVO),
  );
  const setError = (error: string) => setErrors((prevErrors) => [...prevErrors, error]);
  const { addFile, replaceFile, updateFileById, deleteFileById } = useUpdateFiles(
    params?.fileSetter ?? setFiles,
  );
  const { resizeImageIfNeeded } = useClientResize();
  const anonymizeEnabled = useRecoilValue(store.anonymizeEnabled);
  const [pdfPreparation, setPdfPreparation] = useState<PdfPreparationState>({
    open: false,
    status: 'idle',
    fileName: '',
    fileSize: 0,
  });
  const preparedPdfRef = useRef<{ filename: string; anonymizedText: string } | null>(null);
  const preparePollingAbortRef = useRef<AbortController | null>(null);
  const retryPdfPreparationRef = useRef<{ file: File; fileId: string } | null>(null);
  const preparationCancelledRef = useRef(false);
  const preparationTimersRef = useRef<number[]>([]);
  const blurryCapsRef = useRef<{ data: BlurryCapabilities | null; cachedAt: number }>({
    data: null,
    cachedAt: 0,
  });

  const agent_id = params?.additionalMetadata?.agent_id ?? '';
  const assistant_id = params?.additionalMetadata?.assistant_id ?? '';
  const endpointType = useMemo(() => conversation?.endpointType, [conversation?.endpointType]);
  const endpoint = useMemo(() => conversation?.endpoint ?? 'default', [conversation?.endpoint]);

  const { data: fileConfig = null } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });

  const displayToast = useCallback(() => {
    if (errors.length > 1) {
      // TODO: this should not be a dynamic localize input!!
      const errorList = Array.from(new Set(errors))
        .map((e, i) => `${i > 0 ? '• ' : ''}${localize(e as TranslationKeys) || e}\n`)
        .join('');
      showToast({
        message: errorList,
        status: 'error',
        duration: 5000,
      });
    } else if (errors.length === 1) {
      // TODO: this should not be a dynamic localize input!!
      const message = localize(errors[0] as TranslationKeys) || errors[0];
      showToast({
        message,
        status: 'error',
        duration: 5000,
      });
    }

    setErrors([]);
  }, [errors, showToast, localize]);

  const debouncedDisplayToast = debounce(displayToast, 250);

  useEffect(() => {
    if (errors.length > 0) {
      debouncedDisplayToast();
    }

    return () => debouncedDisplayToast.cancel();
  }, [errors, debouncedDisplayToast]);

  useEffect(
    () => () => {
      clearPreparationTimers();
      preparePollingAbortRef.current?.abort('Cleanup prepare polling');
      preparePollingAbortRef.current = null;
    },
    [],
  );

  const uploadFile = useUploadFileMutation(
    {
      onSuccess: (data) => {
        clearUploadTimer(data.temp_file_id);
        console.log('upload success', data);
        if (agent_id) {
          queryClient.refetchQueries([QueryKeys.agent, agent_id]);
          return;
        }
        updateFileById(
          data.temp_file_id,
          {
            progress: 0.9,
            filepath: data.filepath,
          },
          assistant_id ? true : false,
        );

        setTimeout(() => {
          updateFileById(
            data.temp_file_id,
            {
              progress: 1,
              file_id: data.file_id,
              temp_file_id: data.temp_file_id,
              filepath: data.filepath,
              type: data.type,
              height: data.height,
              width: data.width,
              filename: data.filename,
              source: data.source,
              embedded: data.embedded,
            },
            assistant_id ? true : false,
          );
        }, 300);
      },
      onError: (_error, body) => {
        const error = _error as TError | undefined;
        console.log('upload error', error);
        const file_id = body.get('file_id');
        const tool_resource = body.get('tool_resource');
        if (tool_resource === EToolResources.execute_code) {
          setEphemeralAgent((prev) => ({
            ...prev,
            [EToolResources.execute_code]: false,
          }));
        }
        clearUploadTimer(file_id as string);
        deleteFileById(file_id as string);

        let errorMessage = 'com_error_files_upload';

        if (error?.code === 'ERR_CANCELED') {
          errorMessage = 'com_error_files_upload_canceled';
        } else if (error?.response?.data?.message) {
          errorMessage = error.response.data.message;
        }
        setError(errorMessage);
      },
    },
    abortControllerRef.current?.signal,
  );

  const clearPreparationTimers = () => {
    preparationTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    preparationTimersRef.current = [];
  };

  const clearPreparePolling = () => {
    preparePollingAbortRef.current?.abort('Stopped document preparation polling');
    preparePollingAbortRef.current = null;
  };

  const checkBlurryCapabilities = useCallback(async (): Promise<BlurryCapabilities | null> => {
    const cache = blurryCapsRef.current;
    if (cache.data && Date.now() - cache.cachedAt < BLURRY_CAPABILITIES_CACHE_TTL_MS) {
      return cache.data;
    }
    try {
      const caps = await dataService.getBlurryCapabilities<BlurryCapabilities>();
      blurryCapsRef.current = { data: caps, cachedAt: Date.now() };
      return caps;
    } catch {
      return null;
    }
  }, []);

  const mapJobToPreparationStatus = ({
    status,
    stage,
  }: {
    status?: string;
    stage?: string;
  }): PdfPreparationState['status'] => {
    const normalizedStatus = (status || '').toLowerCase();
    const normalizedStage = (stage || '').toLowerCase();

    if (normalizedStatus === 'queued') {
      return 'queued';
    }
    if (normalizedStatus === 'processing') {
      if (normalizedStage.includes('upload')) {
        return 'uploading';
      }
      if (normalizedStage === 'ocr' || normalizedStage.includes('ocr')) {
        return 'ocr';
      }
      if (normalizedStage === 'extracting' || normalizedStage.includes('extract')) {
        return 'processing';
      }
      if (normalizedStage === 'redacting' || normalizedStage.includes('redact')) {
        return 'anonymization';
      }
      if (normalizedStage.includes('chunk')) {
        return 'chunking';
      }
      if (normalizedStage.includes('anonym')) {
        return 'anonymization';
      }
      if (
        normalizedStage === 'packaging' ||
        normalizedStage.includes('rebuild') ||
        normalizedStage.includes('merge') ||
        normalizedStage.includes('final') ||
        normalizedStage.includes('packag')
      ) {
        return 'rebuilding';
      }
      return 'processing';
    }
    if (normalizedStatus === 'completed') {
      return 'review';
    }
    if (normalizedStatus === 'review_required') {
      return 'review_required';
    }
    return 'failed';
  };

  const waitForPollInterval = (delayMs: number, signal?: AbortSignal | null) =>
    new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);

      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new Error('Prepare polling aborted'));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  const pollPreparedJobUntilComplete = async ({
    file,
    fileId,
    jobId,
    signal,
  }: {
    file: File;
    fileId: string;
    jobId: string;
    signal: AbortSignal;
  }) => {
    let intervalMs = PREPARE_POLL_INITIAL_INTERVAL_MS;
    let consecutiveErrors = 0;
    const startedAt = Date.now();

    while (!signal.aborted) {
      let job: PreparedPdfJobResponse;
      try {
        job = await dataService.getPreparedFileJob<PreparedPdfJobResponse>(jobId, signal);
        consecutiveErrors = 0;
      } catch (pollError) {
        if (signal.aborted) throw pollError;
        consecutiveErrors++;
        if (consecutiveErrors > PREPARE_POLL_MAX_RETRIES) throw pollError;
        await waitForPollInterval(intervalMs, signal);
        intervalMs = Math.min(Math.ceil(intervalMs * 1.5), PREPARE_POLL_MAX_INTERVAL_MS);
        continue;
      }
      const responseStatus = (job.status || '').toLowerCase();
      const uiStatus = mapJobToPreparationStatus({
        status: responseStatus,
        stage: job.processingStage,
      });

      // outputs is absent during in-progress polls; treat as pdf-available for backward compat
      const hasPdf = job.outputs?.sanitizedPdf !== false;
      const hasDocx = job.outputs?.sanitizedDocx === true;
      setPdfPreparation((prev) => ({
        ...prev,
        open: true,
        status: uiStatus,
        fileName: prev.fileName || file.name,
        requestId: job.requestId || prev.requestId || fileId,
        jobId,
        providerSafe: responseStatus === 'completed',
        processingStatus: responseStatus,
        processingStage: job.processingStage,
        blurryMessage: job.message ?? undefined,
        progress: typeof job.progress === 'number' ? job.progress : undefined,
        estimatedSeconds: job.estimatedSeconds,
        elapsedMs: job.elapsedMs,
        ocrActive: job.ocrActive,
        pages: job.pagesTotal,
        pagesProcessed: job.pagesProcessed,
        chunkCount: job.chunksTotal,
        chunksProcessed: job.chunksProcessed,
        sanitizedDownloadUrl: hasPdf
          ? job.outputs?.sanitizedPdfUrl ||
            `/api/files/prepare-file/jobs/${encodeURIComponent(jobId)}/download?type=pdf`
          : undefined,
        sanitizedDocxDownloadUrl: hasDocx
          ? job.outputs?.sanitizedDocxUrl ||
            `/api/files/prepare-file/jobs/${encodeURIComponent(jobId)}/download?type=docx`
          : undefined,
        sanitizedFileName: job.outputs?.sanitizedFileName,
        availableArtifacts: {
          sanitizedPdf: hasPdf,
          sanitizedDocx: hasDocx,
          sanitizedText: job.outputs?.sanitizedTextAvailable !== false,
        },
      }));

      const isCompleted = responseStatus === 'completed';
      const isReviewRequired = responseStatus === 'review_required';
      const canDownloadOnReview = isReviewRequired && job.providerSafe === true;

      if (isCompleted || canDownloadOnReview) {
        if (isReviewRequired && !job.providerSafe) {
          const unsafeError = new Error('Documento não validado como seguro pelo provedor.');
          (unsafeError as Error & { code?: string }).code = 'BLURRY_PROVIDER_UNSAFE';
          throw unsafeError;
        }

        const output = await dataService.downloadPreparedFileText<PreparedPdfTextDownload>(
          jobId,
          signal,
        );
        const anonymizedText = output?.text?.trim();
        if (!anonymizedText) {
          const missingTextError = new Error('O texto anonimizado não está disponível.');
          (missingTextError as Error & { code?: string }).code = 'BLURRY_TEXT_OUTPUT_MISSING';
          throw missingTextError;
        }

        preparedPdfRef.current = {
          filename: file.name,
          anonymizedText,
        };

        const hasPdfFinal = job.outputs?.sanitizedPdf !== false;
        const hasDocxFinal = job.outputs?.sanitizedDocx === true;
        setPdfPreparation((prev) => ({
          ...prev,
          open: true,
          status: isReviewRequired ? 'review_required' : 'review',
          providerSafe: true,
          reviewRequired: isReviewRequired,
          anonymizedText,
          requestId: job.requestId || prev.requestId || fileId,
          jobId,
          processingStatus: responseStatus,
          processingStage: isReviewRequired ? 'review_required' : 'completed',
          pages: job.pagesTotal ?? prev.pages,
          pagesProcessed: job.pagesProcessed ?? prev.pagesProcessed,
          chunkCount: job.chunksTotal ?? prev.chunkCount,
          chunksProcessed: job.chunksProcessed ?? prev.chunksProcessed,
          sanitizedDownloadUrl: hasPdfFinal
            ? job.outputs?.sanitizedPdfUrl ||
              `/api/files/prepare-file/jobs/${encodeURIComponent(jobId)}/download?type=pdf`
            : undefined,
          sanitizedDocxDownloadUrl: hasDocxFinal
            ? job.outputs?.sanitizedDocxUrl ||
              `/api/files/prepare-file/jobs/${encodeURIComponent(jobId)}/download?type=docx`
            : undefined,
          sanitizedFileName: job.outputs?.sanitizedFileName,
          availableArtifacts: {
            sanitizedPdf: hasPdfFinal,
            sanitizedDocx: hasDocxFinal,
            sanitizedText: job.outputs?.sanitizedTextAvailable !== false,
          },
        }));
        return;
      }

      if (responseStatus === 'review_required' && !job.providerSafe) {
        const unsafeError = new Error('Documento não validado como seguro pelo provedor.');
        (unsafeError as Error & { code?: string }).code = 'BLURRY_PROVIDER_UNSAFE';
        throw unsafeError;
      }

      if (responseStatus === 'failed') {
        const statusError = new Error(job.message || 'Falha ao preparar o documento.');
        (statusError as Error & { code?: string }).code = job.errorCode || 'BLURRY_JOB_FAILED';
        throw statusError;
      }

      if (Date.now() - startedAt >= PREPARE_POLL_TIMEOUT_MS) {
        const timeoutError = new Error('O processamento excedeu o tempo limite.');
        (timeoutError as Error & { code?: string }).code = 'BLURRY_JOB_TIMEOUT';
        throw timeoutError;
      }

      await waitForPollInterval(intervalMs, signal);
      intervalMs = Math.min(Math.ceil(intervalMs * 1.5), PREPARE_POLL_MAX_INTERVAL_MS);
    }
  };

  const prepareFileForChat = async (file: File, fileId: string) => {
    clearPreparationTimers();
    clearPreparePolling();
    retryPdfPreparationRef.current = { file, fileId };
    preparedPdfRef.current = null;
    preparationCancelledRef.current = false;
    setFilesLoading(true);
    logPreparationTrace({
      stage: 'file_selected',
      fileType: file.type || 'text/plain',
      fileSize: file.size,
      status: 'started',
      requestId: fileId,
    });

    const caps = await checkBlurryCapabilities();
    if (!caps) {
      setFilesLoading(false);
      setPdfPreparation({
        open: true,
        status: 'failed',
        fileName: file.name,
        fileSize: file.size,
        error: preparationErrorMessages['BLURRY_CAPABILITIES_UNAVAILABLE'],
        errorCode: 'BLURRY_CAPABILITIES_UNAVAILABLE',
      });
      return;
    }
    if (caps?.documents?.enabled === false) {
      setFilesLoading(false);
      setPdfPreparation({
        open: true,
        status: 'failed',
        fileName: file.name,
        fileSize: file.size,
        error: preparationErrorMessages['DOCUMENTS_DISABLED'],
        errorCode: 'DOCUMENTS_DISABLED',
      });
      return;
    }
    setPdfPreparation({
      open: true,
      status: 'uploading',
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'text/plain',
      requestId: fileId,
    });

    const formData = new FormData();
    formData.append('endpoint', endpoint);
    formData.append('endpointType', endpointType ?? '');
    formData.append('file', file, encodeURIComponent(file.name));
    formData.append('file_id', fileId);

    try {
      const pollingAbortController = new AbortController();
      preparePollingAbortRef.current = pollingAbortController;

      const result = await dataService.prepareFile<PreparedPdfResponse>(
        formData,
        pollingAbortController.signal,
      );
      if (!result.jobId) {
        throw new Error('Documento não retornou jobId de preparação');
      }

      setPdfPreparation((prev) => ({
        ...prev,
        open: true,
        status: mapJobToPreparationStatus({
          status: result.status || 'processing',
          stage: result.processingStage,
        }),
        requestId: result.requestId || prev.requestId || fileId,
        jobId: result.jobId,
        providerSafe: false,
        processingStatus: result.status || 'processing',
        processingStage: result.processingStage,
      }));

      await pollPreparedJobUntilComplete({
        file,
        fileId,
        jobId: result.jobId,
        signal: pollingAbortController.signal,
      });

      clearPreparePolling();
      clearPreparationTimers();
      return;
    } catch (error) {
      clearPreparationTimers();
      clearPreparePolling();
      if (preparationCancelledRef.current) {
        return;
      }
      const err = error as TError | undefined;
      const data = err?.response?.data as PreparationErrorResponse | undefined;
      const rawErrorCode =
        data?.errorCode || (error as Error & { code?: string })?.code || 'BLURRY_JOB_FAILED';
      // Normalize legacy error codes to canonical names
      const errorCodeMap: Record<string, string> = {
        TIMEOUT: 'BLURRY_JOB_TIMEOUT',
        SANITIZED_TEXT_MISSING: 'BLURRY_TEXT_OUTPUT_MISSING',
        TEXT_DOWNLOAD_FAILED: 'BLURRY_DOWNLOAD_FAILED',
        PDF_DOWNLOAD_FAILED: 'BLURRY_DOWNLOAD_FAILED',
        PROVIDER_SAFE_MISSING: 'BLURRY_PROVIDER_UNSAFE',
      };
      const errorCode = errorCodeMap[rawErrorCode] ?? rawErrorCode;
      const safeMessage =
        preparationErrorMessages[errorCode] ||
        preparationErrorMessages[rawErrorCode] ||
        'Falha ao preparar o arquivo com segurança. O envio foi bloqueado.';
      logPreparationTrace({
        stage: data?.stage || 'failed',
        errorCode,
        fileType: data?.fileType || file.type || 'text/plain',
        fileSize: data?.fileSize || file.size,
        pages: data?.pages,
        chunksTotal: data?.chunksTotal,
        chunkIndex: data?.chunkIndex,
        status: data?.status || 'failed',
        requestId: data?.requestId || fileId,
      });
      setPdfPreparation((prev) => ({
        ...prev,
        open: true,
        status: 'failed',
        error: safeMessage,
        errorCode,
        errorStage: data?.stage || 'failed',
        requestId: data?.requestId || fileId,
      }));
    }
  };

  const cancelPdfPreparation = () => {
    clearPreparationTimers();
    preparationCancelledRef.current = true;
    clearPreparePolling();
    preparedPdfRef.current = null;
    setFilesLoading(false);
    setPdfPreparation((prev) => ({ ...prev, open: false, status: 'cancelled' }));
  };

  const confirmPdfPreparation = () => {
    const prepared = preparedPdfRef.current;
    if (!prepared) {
      return;
    }
    setPdfPreparation((prev) => ({ ...prev, status: 'sending' }));
    params?.onPreparedPdfConfirm?.(prepared);
    preparedPdfRef.current = null;
    retryPdfPreparationRef.current = null;
    setFilesLoading(false);
    setPdfPreparation((prev) => ({ ...prev, open: false, status: 'completed' }));
  };

  const retryPdfPreparation = () => {
    const retry = retryPdfPreparationRef.current;
    if (!retry) {
      return;
    }
    prepareFileForChat(retry.file, retry.fileId);
  };

  const startUpload = async (extendedFile: ExtendedFile) => {
    const filename = extendedFile.file?.name ?? 'File';
    startUploadTimer(extendedFile.file_id, filename, extendedFile.size);

    const formData = new FormData();
    formData.append('endpoint', endpoint);
    formData.append('endpointType', endpointType ?? '');
    formData.append('file', extendedFile.file as File, encodeURIComponent(filename));
    formData.append('file_id', extendedFile.file_id);
    formData.append('anonymize', anonymizeEnabled ? 'true' : 'false');

    const width = extendedFile.width ?? 0;
    const height = extendedFile.height ?? 0;
    if (width) {
      formData.append('width', width.toString());
    }
    if (height) {
      formData.append('height', height.toString());
    }

    const metadata = params?.additionalMetadata ?? {};
    if (params?.additionalMetadata) {
      for (const [key, value = ''] of Object.entries(metadata)) {
        if (value) {
          formData.append(key, value);
        }
      }
    }

    if (!isAssistantsEndpoint(endpointType ?? endpoint)) {
      if (!agent_id) {
        formData.append('message_file', 'true');
      }
      const tool_resource = extendedFile.tool_resource;
      if (tool_resource != null) {
        formData.append('tool_resource', tool_resource);
      }
      if (conversation?.agent_id != null && formData.get('agent_id') == null) {
        formData.append('agent_id', conversation.agent_id);
      }

      uploadFile.mutate(formData);
      return;
    }

    const convoModel = conversation?.model ?? '';
    const convoAssistantId = conversation?.assistant_id ?? '';

    if (!assistant_id) {
      formData.append('message_file', 'true');
    }

    const endpointsConfig = queryClient.getQueryData<TEndpointsConfig>([QueryKeys.endpoints]);
    const version = endpointsConfig?.[endpoint]?.version ?? defaultAssistantsVersion[endpoint];

    if (!assistant_id && convoAssistantId) {
      formData.append('version', version);
      formData.append('model', convoModel);
      formData.append('assistant_id', convoAssistantId);
    }

    const formVersion = (formData.get('version') ?? '') as string;
    if (!formVersion) {
      formData.append('version', version);
    }

    const formModel = (formData.get('model') ?? '') as string;
    if (!formModel) {
      formData.append('model', convoModel);
    }

    uploadFile.mutate(formData);
  };

  const loadImage = (extendedFile: ExtendedFile, preview: string) => {
    const img = new Image();
    img.onload = async () => {
      extendedFile.width = img.width;
      extendedFile.height = img.height;
      extendedFile = {
        ...extendedFile,
        progress: 0.6,
      };
      replaceFile(extendedFile);

      await startUpload(extendedFile);
      URL.revokeObjectURL(preview);
    };
    img.src = preview;
  };

  const handleFiles = async (_files: FileList | File[], _toolResource?: string) => {
    abortControllerRef.current = new AbortController();
    const fileList = Array.from(_files);
    /* Validate files */
    let filesAreValid: boolean;
    try {
      const endpointFileConfig = getEndpointFileConfig({
        endpoint,
        fileConfig,
        endpointType,
      });

      filesAreValid = validateFiles({
        files,
        fileList,
        setError,
        fileConfig,
        endpointFileConfig,
        toolResource: _toolResource,
      });
    } catch (error) {
      console.error('file validation error', error);
      setError('com_error_files_validation');
      return;
    }
    if (!filesAreValid) {
      setFilesLoading(false);
      return;
    }

    /* Process files */
    for (const originalFile of fileList) {
      const file_id = v4();
      try {
        if (anonymizeEnabled && !_toolResource && params?.onPreparedPdfConfirm) {
          await prepareFileForChat(originalFile, file_id);
          continue;
        }

        // Create initial preview with original file
        const initialPreview = URL.createObjectURL(originalFile);

        // Create initial ExtendedFile to show immediately
        const initialExtendedFile: ExtendedFile = {
          file_id,
          file: originalFile,
          type: originalFile.type,
          preview: initialPreview,
          progress: 0.1, // Show as processing
          size: originalFile.size,
        };

        if (_toolResource != null && _toolResource !== '') {
          initialExtendedFile.tool_resource = _toolResource;
        }

        // Add file immediately to show in UI
        addFile(initialExtendedFile);

        // Check if HEIC conversion is needed and show toast
        const isHEIC =
          originalFile.type === 'image/heic' ||
          originalFile.type === 'image/heif' ||
          originalFile.name.toLowerCase().match(/\.(heic|heif)$/);

        if (isHEIC) {
          showToast({
            message: localize('com_info_heic_converting'),
            status: 'info',
            duration: 3000,
          });
        }

        // Process file for HEIC conversion if needed
        const heicProcessedFile = await processFileForUpload(
          originalFile,
          0.9,
          (conversionProgress) => {
            // Update progress during HEIC conversion (0.1 to 0.5 range for conversion)
            const adjustedProgress = 0.1 + conversionProgress * 0.4;
            replaceFile({
              ...initialExtendedFile,
              progress: adjustedProgress,
            });
          },
        );

        let finalProcessedFile = heicProcessedFile;

        // Apply client-side resizing if available and appropriate
        if (heicProcessedFile.type.startsWith('image/')) {
          try {
            const resizeResult = await resizeImageIfNeeded(heicProcessedFile);
            finalProcessedFile = resizeResult.file;

            // Show toast notification if image was resized
            if (resizeResult.resized && resizeResult.result) {
              const { originalSize, newSize, compressionRatio } = resizeResult.result;
              const originalSizeMB = (originalSize / (1024 * 1024)).toFixed(1);
              const newSizeMB = (newSize / (1024 * 1024)).toFixed(1);
              const savedPercent = Math.round((1 - compressionRatio) * 100);

              showToast({
                message: `Image resized: ${originalSizeMB}MB → ${newSizeMB}MB (${savedPercent}% smaller)`,
                status: 'success',
                duration: 3000,
              });
            }
          } catch (resizeError) {
            console.warn('Image resize failed, using original:', resizeError);
            // Continue with HEIC processed file if resizing fails
          }
        }

        // If file was processed (HEIC converted or resized), update with new file and preview
        if (finalProcessedFile !== originalFile) {
          URL.revokeObjectURL(initialPreview); // Clean up original preview
          const newPreview = URL.createObjectURL(finalProcessedFile);

          const updatedExtendedFile: ExtendedFile = {
            ...initialExtendedFile,
            file: finalProcessedFile,
            type: finalProcessedFile.type,
            preview: newPreview,
            progress: 0.5, // Processing complete, ready for upload
            size: finalProcessedFile.size,
          };

          replaceFile(updatedExtendedFile);

          const isImage = finalProcessedFile.type.split('/')[0] === 'image';
          if (isImage) {
            loadImage(updatedExtendedFile, newPreview);
            continue;
          }

          await startUpload(updatedExtendedFile);
        } else {
          // File wasn't processed, proceed with original
          const isImage = originalFile.type.split('/')[0] === 'image';

          // Update progress to show ready for upload
          const readyExtendedFile = {
            ...initialExtendedFile,
            progress: 0.2,
          };
          replaceFile(readyExtendedFile);

          if (isImage) {
            loadImage(readyExtendedFile, initialPreview);
            continue;
          }

          await startUpload(readyExtendedFile);
        }
      } catch (error) {
        deleteFileById(file_id);
        console.log('file handling error', error);
        if (error instanceof Error && error.message.includes('HEIC')) {
          setError('com_error_heic_conversion');
        } else {
          setError('com_error_files_process');
        }
      }
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, _toolResource?: string) => {
    event.stopPropagation();
    if (event.target.files) {
      setFilesLoading(true);
      handleFiles(event.target.files, _toolResource);
      // reset the input
      event.target.value = '';
    }
  };

  const abortUpload = () => {
    if (abortControllerRef.current) {
      logger.log('files', 'Aborting upload');
      abortControllerRef.current.abort('User aborted upload');
      abortControllerRef.current = null;
    }
  };

  return {
    handleFileChange,
    handleFiles,
    abortUpload,
    pdfPreparation,
    cancelPdfPreparation,
    confirmPdfPreparation,
    retryPdfPreparation,
    setFiles,
    files,
  };
};

export default useFileHandling;
