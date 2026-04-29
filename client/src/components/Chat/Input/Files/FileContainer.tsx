import type { TFile } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useRecoilValue } from 'recoil';
import { Spinner } from '@librechat/client';
import { getFileType, cn } from '~/utils';
import FilePreview from './FilePreview';
import RemoveFile from './RemoveFile';
import store from '~/store';

const FileContainer = ({
  file,
  overrideType,
  buttonClassName,
  containerClassName,
  onDelete,
  onClick,
}: {
  file: Partial<ExtendedFile | TFile>;
  overrideType?: string;
  buttonClassName?: string;
  containerClassName?: string;
  onDelete?: () => void;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) => {
  const fileType = getFileType(overrideType ?? file.type);
  const isAnonymizedPdf =
    (overrideType ?? file.type) === 'application/pdf' && file.metadata?.anonymized;
  const anonymizeEnabled = useRecoilValue(store.anonymizeEnabled);
  const uploadedButNotYetAnonymized =
    anonymizeEnabled &&
    (file as ExtendedFile).progress != null &&
    (file as ExtendedFile).progress >= 1 &&
    !file.metadata?.anonymized;

  return (
    <div
      className={cn('group relative inline-block text-sm text-text-primary', containerClassName)}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={file.filename}
        className={cn(
          'relative overflow-hidden rounded-2xl border border-border-light bg-surface-hover-alt',
          buttonClassName,
        )}
      >
        <div className="w-56 p-1.5">
          <div className="flex flex-row items-center gap-2">
            <FilePreview file={file} fileType={fileType} className="relative" />
            <div className="overflow-hidden">
              <div className="truncate font-medium" title={file.filename}>
                {file.filename}
              </div>
              <div className="truncate text-text-secondary" title={fileType.title}>
                {fileType.title}
              </div>
              {uploadedButNotYetAnonymized && (
                <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <Spinner size={10} color="currentColor" />
                  Escaneando…
                </div>
              )}
              {isAnonymizedPdf && !uploadedButNotYetAnonymized && (
                <div className="mt-1 inline-flex rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-600">
                  PDF anonimizado
                </div>
              )}
            </div>
          </div>
        </div>
      </button>
      {onDelete && <RemoveFile onRemove={onDelete} />}
    </div>
  );
};

export default FileContainer;
