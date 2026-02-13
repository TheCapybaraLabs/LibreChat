const fs = require('fs');
const { logger } = require('@librechat/data-schemas');

let pdfjsLib;
try {
  pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
} catch (error) {
  pdfjsLib = null;
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
    .trim();
};

const getPdfLimits = () => {
  const maxPages = Number(process.env.PDF_TEXT_MAX_PAGES) || DEFAULT_MAX_PAGES;
  const maxChars = Number(process.env.PDF_TEXT_MAX_CHARS) || DEFAULT_MAX_CHARS;
  return { maxPages, maxChars };
};

async function extractPdfText({ filePath }) {
  if (!pdfjsLib) {
    throw new Error('pdfjs-dist is not installed');
  }

  const { maxPages, maxChars } = getPdfLimits();
  const data = fs.readFileSync(filePath);
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(data),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel?.ERRORS ?? 0,
  });

  const pdf = await loadingTask.promise;
  const totalPages = Math.min(pdf.numPages, maxPages);

  let text = '';

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
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
  }

  const normalized = normalizeText(text);
  return {
    text: normalized,
    chars: normalized.length,
    pagesProcessed: totalPages,
  };
}

module.exports = {
  extractPdfText,
  normalizeText,
  getPdfLimits,
};
