export const BLURRY_ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const BLURRY_ALLOWED_EXT = new Set(['.pdf', '.docx']);

export const BLURRY_ACCEPT_ATTR =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const BLURRY_FILE_REJECTED_ERROR =
  'Tipo de arquivo não suportado. Envie apenas arquivos PDF ou DOCX para anonimização segura.';

export function isAllowedForBlurry(file: Pick<File, 'type' | 'name'>): boolean {
  if (file.type && BLURRY_ALLOWED_MIME.has(file.type)) {
    return true;
  }
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
  return BLURRY_ALLOWED_EXT.has(ext);
}
