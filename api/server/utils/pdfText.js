const fs = require('fs');
const { logger } = require('@librechat/data-schemas');

let pdfjsLib;

async function getPdfjsLib() {
  if (pdfjsLib) {
    return pdfjsLib;
  }

  try {
    // In pdfjs-dist v4, we must use dynamic import as it's ESM only
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    logger.info('[pdfText] Successfully loaded pdfjsLib via dynamic import');
    return pdfjsLib;
  } catch (error) {
    logger.error('[pdfText] Failed to load pdfjs-dist via dynamic import', {
      message: error.message,
      stack: error.stack,
    });
    const _error = new Error('O extrator de texto PDF não está disponível no servidor.');  _error.code = 'PDF_PARSER_NOT_AVAILABLE'; throw _error;
  }
}

const DEFAULT_MAX_PAGES = 200;
const DEFAULT_MAX_CHARS = 2_000_000;

const normalizeText = (text) => {
  if (!text) {
    return '';
  }
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +/g, ' ')
    .trim();
};

const getPdfLimits = () => {
  const maxPages = Number(process.env.PDF_TEXT_MAX_PAGES) || DEFAULT_MAX_PAGES;
   const maxChars = Number(process.env.PDF_TEXT_MAX_CHARS) || DEFAULT_MAX_CHARS;
  return { maxPages, maxChars };
};

async function extractPdfText({ filePath }) {
  const lib = await getPdfjsLib();
  const { maxPages, maxChars } = getPdfLimits();
  let data;
  try {
    data = fs.readFileSync(filePath);
  } catch (error) {
    logger.error('[extractPdfText] Failed to read PDF file', {
      filePath,
      error: error.message,
    });
    const _error = new Error('Não foi possível ler o arquivo do documento.');  _error.code = 'PDF_READ_FAILED'; throw _error;
  }

  logger.info('[extractPdfText] pdf_load_started', {
    size: data.length,
    max_pages: maxPages,
    max_chars: maxChars,
  });

  try {
    const loadingTask = lib.getDocument({
      data: new Uint8Array(data),
      disableWorker: true,
      verbosity: lib.VerbosityLevel?.ERRORS ?? 0,
    });

    const pdf = await loadingTask.promise;
    const totalPages = Math.min(pdf.numPages, maxPages);
    logger.info('[extractPdfText] pdf_loaded', {
      pages: pdf.numPages,
      pages_processed: totalPages,
    });

    let text = '';

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => item.str).join(' ');
        if (pageText) {
          text += `${pageText}\n\n`;
        }

        if (text.length >= maxChars) {
          logger.warn(
            `[extractPdfText] Reached PDF_TEXT_MAX_CHARS limit (${maxChars}) for ${filePath}`,
          );
          break;
        }
      } catch (pageError) {
        logger.error(`[extractPdfText] Error processing page ${pageNum}`, {
          error: pageError.message,
        });
      }
    }

    const normalized = normalizeText(text);
    logger.info('[extractPdfText] extract_completed', {
      chars: normalized.length,
      pages_processed: totalPages,
    });
    return {
      text: normalized,
      chars: normalized.length,
      pagesProcessed: totalPages,
    };
  } catch (error) {
    logger.error('[extractPdfText] PDF extraction failed', {
      message: error.message,
      stack: error.stack,
    });
    const _error = new Error('Não foi possível extrair o texto deste PDF. Ele pode ser um arquivo de imagem ou estar protegido.');  _error.code = 'PDF_EXTRACTION_FAILED'; throw _error;
  }
}

module.exports = {
  extractPdfText,
  normalizeText,
  getPdfLimits,
};
