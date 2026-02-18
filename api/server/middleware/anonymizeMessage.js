const { handleError } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const blurryClient = require('../utils/blurryClient');

async function anonymizeMessage(req, res, next) {
  const { text, anonymize } = req.body;

  if (anonymize !== true) {
    return next();
  }

  const failClosed = process.env.BLURRY_FAIL_CLOSED !== 'false';

  try {
    if (!process.env.BLURRY_API_KEY) {
      logger.error('Anonymization requested but BLURRY_API_KEY is missing');
      return handleError(res, { text: 'Configuração de anonimização ausente (API Key).' });
    }

    if (!text || typeof text !== 'string') {
      return next();
    }

    const result = await blurryClient.anonymizeText({
      text,
      policy: 'default',
      anonymization_level: 'full',
      return_entities: true,
    });
    
    // Replace original text with anonymized version
    req.body.text = result.anonymized_text;
    
    // Store metadata to be saved with the message
    req.body.anonymized = true;
    req.body.anonymization_level = 'full';
    req.body.entities = result.entities;
    req.body.stats = result.stats;
    req.body.processing_ms = result.processing_ms;

    next();
  } catch (error) {
    logger.error('Error in anonymizeMessage middleware:', error);
    
    if (failClosed) {
      return handleError(res, { text: 'Falha na anonimização do texto. A mensagem não foi enviada por segurança.' });
    }
    
    next();
  }
}

module.exports = anonymizeMessage;
