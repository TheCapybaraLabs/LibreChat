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
  requestId?: string;
  providerSafe: boolean;
  anonymizedText: string;
  filename: string;
  mimeType?: string;
  type?: string;
  pages?: number;
  lines?: number;
  entityCount?: number;
  chunks?: { total: number; succeeded: number; failed: number };
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

const preparationErrorMessages: Record<string, string> = {
  PDF_TEXT_EXTRACTION_FAILED: 'Não foi possível extrair texto deste PDF.',
  PDF_NO_SELECTABLE_TEXT: 'Este PDF não possui texto selecionável.',
  BLURRY_ANONYMIZE_FAILED: 'A anonimização falhou em uma parte do documento.',
  BLURRY_TIMEOUT: 'O serviço de anonimização demorou mais que o esperado.',
  INVALID_ANONYMIZE_RESPONSE: 'A resposta de anonimização veio inválida.',
};

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
  console.debug('[file-preparation]', trace);
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
  const retryPdfPreparationRef = useRef<{ file: File; fileId: string } | null>(null);
  const preparationCancelledRef = useRef(false);
  const preparationTimersRef = useRef<number[]>([]);

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

  const prepareFileForChat = async (file: File, fileId: string) => {
    clearPreparationTimers();
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
    setPdfPreparation({
      open: true,
      status: 'extracting',
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'text/plain',
      requestId: fileId,
    });

    preparationTimersRef.current = [
      window.setTimeout(() => {
        logPreparationTrace({
          stage: 'chunking_started',
          fileType: file.type || 'text/plain',
          fileSize: file.size,
          status: 'started',
          requestId: fileId,
        });
        setPdfPreparation((prev) =>
          prev.open && prev.status === 'extracting' ? { ...prev, status: 'chunking' } : prev,
        );
      }, 700),
      window.setTimeout(() => {
        logPreparationTrace({
          stage: 'anonymize_started',
          fileType: file.type || 'text/plain',
          fileSize: file.size,
          status: 'started',
          requestId: fileId,
        });
        setPdfPreparation((prev) =>
          prev.open && (prev.status === 'extracting' || prev.status === 'chunking')
            ? { ...prev, status: 'anonymizing' }
            : prev,
        );
      }, 1400),
    ];

    const formData = new FormData();
    formData.append('endpoint', endpoint);
    formData.append('endpointType', endpointType ?? '');
    formData.append('file', file, encodeURIComponent(file.name));
    formData.append('file_id', fileId);

    try {
      const result = await dataService.prepareFile<PreparedPdfResponse>(
        formData,
        abortControllerRef.current?.signal,
      );
      if (!result.providerSafe || !result.anonymizedText) {
        throw new Error('Prepared PDF was not marked provider-safe');
      }
      clearPreparationTimers();
      logPreparationTrace({
        stage: 'ready',
        fileType: result.mimeType || file.type || result.type,
        fileSize: file.size,
        pages: result.pages,
        chunksTotal: result.chunks?.total,
        status: 'ready',
        requestId: result.requestId || fileId,
      });
      preparedPdfRef.current = {
        filename: result.filename || file.name,
        anonymizedText: result.anonymizedText,
      };
      setPdfPreparation({
        open: true,
        status: 'review',
        fileName: result.filename || file.name,
        fileSize: file.size,
        fileType: result.mimeType || file.type || result.type,
        pages: result.pages,
        lines: result.lines,
        chunkCount: result.chunks?.total,
        entityCount: result.entityCount,
        providerSafe: result.providerSafe,
        requestId: result.requestId || fileId,
        anonymizedText: result.anonymizedText,
      });
    } catch (error) {
      clearPreparationTimers();
      if (preparationCancelledRef.current) {
        return;
      }
      const err = error as TError | undefined;
      const data = err?.response?.data as PreparationErrorResponse | undefined;
      const errorCode = data?.errorCode;
      const safeMessage =
        (errorCode && preparationErrorMessages[errorCode]) ||
        data?.message ||
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
    if (
      pdfPreparation.status === 'extracting' ||
      pdfPreparation.status === 'chunking' ||
      pdfPreparation.status === 'anonymizing'
    ) {
      abortControllerRef.current?.abort('User cancelled PDF preparation');
      abortControllerRef.current = null;
    }
    preparedPdfRef.current = null;
    retryPdfPreparationRef.current = null;
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
    setPdfPreparation((prev) => ({ ...prev, open: false, status: 'ready' }));
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
