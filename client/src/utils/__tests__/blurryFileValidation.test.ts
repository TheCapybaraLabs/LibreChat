import {
  isAllowedForBlurry,
  BLURRY_ALLOWED_MIME,
  BLURRY_ALLOWED_EXT,
  BLURRY_ACCEPT_ATTR,
  BLURRY_FILE_REJECTED_ERROR,
} from '../blurryFileValidation';

const file = (name: string, type: string) => ({ name, type } as Pick<File, 'name' | 'type'>);

// ─── 1. PDF é aceito ──────────────────────────────────────────────────────────
describe('1. PDF é aceito', () => {
  it('application/pdf com extensão .pdf é permitido', () => {
    expect(isAllowedForBlurry(file('relatorio.pdf', 'application/pdf'))).toBe(true);
  });
});

// ─── 2. DOCX é aceito ─────────────────────────────────────────────────────────
describe('2. DOCX é aceito', () => {
  it('MIME de DOCX com extensão .docx é permitido', () => {
    const mime =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(isAllowedForBlurry(file('contrato.docx', mime))).toBe(true);
  });
});

// ─── 3. TXT é bloqueado ───────────────────────────────────────────────────────
describe('3. TXT é bloqueado', () => {
  it('text/plain com .txt é rejeitado', () => {
    expect(isAllowedForBlurry(file('notas.txt', 'text/plain'))).toBe(false);
  });
});

// ─── 4. CSV é bloqueado ───────────────────────────────────────────────────────
describe('4. CSV é bloqueado', () => {
  it('text/csv com .csv é rejeitado', () => {
    expect(isAllowedForBlurry(file('dados.csv', 'text/csv'))).toBe(false);
  });
});

// ─── 5. Imagem é bloqueada ────────────────────────────────────────────────────
describe('5. Imagem é bloqueada', () => {
  it('image/png com .png é rejeitado', () => {
    expect(isAllowedForBlurry(file('foto.png', 'image/png'))).toBe(false);
  });

  it('image/jpeg com .jpg é rejeitado', () => {
    expect(isAllowedForBlurry(file('foto.jpg', 'image/jpeg'))).toBe(false);
  });
});

// ─── 6. DOC legado é bloqueado ────────────────────────────────────────────────
describe('6. DOC legado é bloqueado', () => {
  it('application/msword com .doc é rejeitado', () => {
    expect(isAllowedForBlurry(file('antigo.doc', 'application/msword'))).toBe(false);
  });
});

// ─── 7. Arquivo sem MIME mas com .pdf é aceito ───────────────────────────────
describe('7. Arquivo sem MIME mas com extensão .pdf é aceito', () => {
  it('type vazio e nome .pdf cai no fallback de extensão', () => {
    expect(isAllowedForBlurry(file('documento.pdf', ''))).toBe(true);
  });
});

// ─── 8. Arquivo sem MIME mas com .docx é aceito ──────────────────────────────
describe('8. Arquivo sem MIME mas com extensão .docx é aceito', () => {
  it('type vazio e nome .docx cai no fallback de extensão', () => {
    expect(isAllowedForBlurry(file('formulario.docx', ''))).toBe(true);
  });
});

// ─── 9. accept attr contém PDF e DOCX ────────────────────────────────────────
describe('9. BLURRY_ACCEPT_ATTR inclui PDF e DOCX, não inclui outros tipos', () => {
  it('accept inclui .pdf e .docx', () => {
    expect(BLURRY_ACCEPT_ATTR).toContain('.pdf');
    expect(BLURRY_ACCEPT_ATTR).toContain('.docx');
    expect(BLURRY_ACCEPT_ATTR).toContain('application/pdf');
    expect(BLURRY_ACCEPT_ATTR).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('accept não contém tipos bloqueados', () => {
    expect(BLURRY_ACCEPT_ATTR).not.toContain('image/');
    expect(BLURRY_ACCEPT_ATTR).not.toContain('text/');
    expect(BLURRY_ACCEPT_ATTR).not.toContain('.txt');
    expect(BLURRY_ACCEPT_ATTR).not.toContain('.csv');
    expect(BLURRY_ACCEPT_ATTR).not.toContain('.doc,'); // .doc sem x
  });
});

// ─── 10. Mensagem de erro é clara ─────────────────────────────────────────────
describe('10. Mensagem de erro BLURRY_FILE_REJECTED_ERROR é clara', () => {
  it('menciona PDF e DOCX explicitamente', () => {
    expect(BLURRY_FILE_REJECTED_ERROR).toContain('PDF');
    expect(BLURRY_FILE_REJECTED_ERROR).toContain('DOCX');
  });

  it('menciona anonimização', () => {
    expect(BLURRY_FILE_REJECTED_ERROR.toLowerCase()).toContain('anonimiz');
  });

  it('JSON e XML também bloqueados por não estarem em BLURRY_ALLOWED_EXT', () => {
    expect(isAllowedForBlurry(file('config.json', 'application/json'))).toBe(false);
    expect(isAllowedForBlurry(file('data.xml', 'application/xml'))).toBe(false);
  });
});
