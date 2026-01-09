import { logger } from '../utils/logger.js';

/**
 * Intent detection service
 * Detects user intent from natural language and extracts entities
 */

// Intent types
export const INTENT_TYPES = {
  COVERAGE: 'coverage',
  PLAN: 'plan',
  DEVICE: 'device',
  PROTECTION: 'protection',
  CHECKOUT: 'checkout',
  EDIT: 'edit',
  SIM: 'sim',
  LINE_COUNT: 'line_count',
  OTHER: 'other'
};

// Intent patterns (keywords and phrases)
const INTENT_PATTERNS = {
  [INTENT_TYPES.COVERAGE]: [
    /coverage/i, /signal/i, /network/i, /reception/i, /service area/i,
    /works in/i, /available in/i, /zip code/i, /zipcode/i, /postal code/i,
    /check coverage/i, /coverage check/i, /coverage for/i
  ],
  [INTENT_TYPES.PLAN]: [
    /plan/i, /plans/i, /package/i, /package/i, /data plan/i, /mobile plan/i,
    /service plan/i, /monthly plan/i, /unlimited/i, /data/i, /gb/i,
    /show plans/i, /see plans/i, /available plans/i, /plan options/i,
    /choose plan/i, /select plan/i, /pick plan/i
  ],
  [INTENT_TYPES.DEVICE]: [
    /device/i, /phone/i, /smartphone/i, /iphone/i, /android/i, /samsung/i,
    /pixel/i, /google/i, /apple/i, /show devices/i, /see devices/i,
    /available devices/i, /device options/i, /buy phone/i, /purchase device/i,
    /device catalog/i, /phone catalog/i, /buy.*device/i, /buy.*phone/i,
    /buy.*mobile/i, /purchase.*phone/i, /purchase.*mobile/i, /want.*device/i,
    /want.*phone/i, /need.*device/i, /need.*phone/i, /looking.*for.*device/i,
    /looking.*for.*phone/i, /shop.*device/i, /shop.*phone/i, /get.*device/i,
    /get.*phone/i, /browse.*device/i, /browse.*phone/i
  ],
  [INTENT_TYPES.PROTECTION]: [
    /protection/i, /insurance/i, /warranty/i, /device protection/i,
    /phone protection/i, /coverage plan/i, /protection plan/i,
    /add protection/i, /device insurance/i
  ],
  [INTENT_TYPES.CHECKOUT]: [
    /checkout/i, /proceed/i, /complete/i, /finish/i, /finalize/i,
    /place order/i, /buy now/i, /purchase/i, /order/i, /submit/i,
    /ready to checkout/i, /go to checkout/i, /review and checkout/i,
    /complete purchase/i, /final review/i
  ],
  [INTENT_TYPES.EDIT]: [
    /change/i, /edit/i, /update/i, /modify/i, /remove/i, /delete/i,
    /switch/i, /replace/i, /swap/i, /different/i, /instead/i,
    /change plan/i, /remove device/i, /edit cart/i, /update line/i
  ],
  [INTENT_TYPES.SIM]: [
    /sim/i, /esim/i, /physical sim/i, /psim/i, /sim card/i,
    /sim type/i, /sim option/i, /choose sim/i, /select sim/i
  ],
  [INTENT_TYPES.LINE_COUNT]: [
    /line/i, /lines/i, /how many/i, /number of/i, /family plan/i,
    /multiple lines/i, /single line/i, /one line/i, /two lines/i,
    /three lines/i, /four lines/i, /five lines/i
  ]
};

/**
 * Detect intent from user message
 * @param {string} userMessage - User's message
 * @param {Object} context - Flow context (optional)
 * @returns {Object} { intent, confidence, entities }
 */
export function detectIntent(userMessage, context = {}) {
  if (!userMessage || typeof userMessage !== 'string') {
    return {
      intent: INTENT_TYPES.OTHER,
      confidence: 0,
      entities: {}
    };
  }

  const message = userMessage.toLowerCase().trim();
  const intentScores = {};
  const entities = extractEntities(userMessage, context);

  // Score each intent based on pattern matches
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        score += 1;
      }
    }
    if (score > 0) {
      intentScores[intent] = score;
    }
  }

  // Special handling for checkout in context
  if (context.flowStage === 'review' || context.flowStage === 'checkout') {
    if (/yes/i.test(message) || /proceed/i.test(message) || /continue/i.test(message)) {
      intentScores[INTENT_TYPES.CHECKOUT] = (intentScores[INTENT_TYPES.CHECKOUT] || 0) + 5;
    }
  }

  // Determine primary intent
  let detectedIntent = INTENT_TYPES.OTHER;
  let maxScore = 0;

  for (const [intent, score] of Object.entries(intentScores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedIntent = intent;
    }
  }

  // If multiple intents detected, prioritize based on context
  if (maxScore > 0) {
    // If checkout intent and prerequisites not met, might be asking about missing items
    if (detectedIntent === INTENT_TYPES.CHECKOUT && context.missingPrerequisites) {
      // Check if user is asking about missing items
      if (/plan/i.test(message) && context.missingPrerequisites.includes('plans')) {
        detectedIntent = INTENT_TYPES.PLAN;
      } else if (/device/i.test(message) && context.missingPrerequisites.includes('devices')) {
        detectedIntent = INTENT_TYPES.DEVICE;
      }
    }
  }

  const confidence = maxScore > 0 ? Math.min(maxScore / 5, 1) : 0.1;

  logger.info('Intent detected', {
    message: userMessage.substring(0, 100),
    intent: detectedIntent,
    confidence,
    scores: intentScores,
    entities
  });

  return {
    intent: detectedIntent,
    confidence,
    entities,
    allScores: intentScores
  };
}

/**
 * Extract entities from user message
 * @param {string} userMessage - User's message
 * @param {Object} context - Flow context (optional)
 * @returns {Object} Extracted entities
 */
export function extractEntities(userMessage, context = {}) {
  const entities = {
    zipCode: null,
    lineNumber: null,
    lineNumbers: [],
    planId: null,
    deviceId: null,
    deviceSku: null,
    brand: null,
    simType: null,
    action: null,
    itemType: null,
    maxPrice: null,
    lineCount: null
  };

  const message = userMessage;

  // Extract ZIP code (5 digits or 5+4 format)
  const zipMatch = message.match(/\b(\d{5})(?:-(\d{4}))?\b/);
  if (zipMatch) {
    entities.zipCode = zipMatch[1];
  }

  // Extract line numbers (line 1, line 2, first line, etc.)
  const lineMatches = [
    ...message.matchAll(/line\s*(\d+)/gi),
    ...message.matchAll(/(?:first|1st)\s*line/gi),
    ...message.matchAll(/(?:second|2nd)\s*line/gi),
    ...message.matchAll(/(?:third|3rd)\s*line/gi),
    ...message.matchAll(/(?:fourth|4th)\s*line/gi),
    ...message.matchAll(/(?:fifth|5th)\s*line/gi)
  ];

  if (lineMatches.length > 0) {
    for (const match of lineMatches) {
      if (match[1]) {
        const lineNum = parseInt(match[1], 10);
        if (!entities.lineNumbers.includes(lineNum)) {
          entities.lineNumbers.push(lineNum);
        }
      } else {
        // Handle ordinal words
        const ordinals = {
          'first': 1, '1st': 1,
          'second': 2, '2nd': 2,
          'third': 3, '3rd': 3,
          'fourth': 4, '4th': 4,
          'fifth': 5, '5th': 5
        };
        const word = match[0].toLowerCase();
        for (const [key, value] of Object.entries(ordinals)) {
          if (word.includes(key)) {
            if (!entities.lineNumbers.includes(value)) {
              entities.lineNumbers.push(value);
            }
            break;
          }
        }
      }
    }
    if (entities.lineNumbers.length === 1) {
      entities.lineNumber = entities.lineNumbers[0];
    }
  }

  // Extract line count (1 line, 2 lines, family plan 4 lines, etc.)
  const lineCountMatch = message.match(/(\d+)\s*line/i);
  if (lineCountMatch) {
    entities.lineCount = parseInt(lineCountMatch[1], 10);
  } else {
    // Check for common phrases
    if (/single\s*line|one\s*line/i.test(message)) {
      entities.lineCount = 1;
    } else if (/two\s*lines|couple/i.test(message)) {
      entities.lineCount = 2;
    } else if (/three\s*lines/i.test(message)) {
      entities.lineCount = 3;
    } else if (/four\s*lines|family\s*plan/i.test(message)) {
      entities.lineCount = 4;
    }
  }

  // Extract brand names
  const brands = ['apple', 'iphone', 'samsung', 'google', 'pixel', 'oneplus', 'motorola', 'nokia'];
  for (const brand of brands) {
    if (new RegExp(`\\b${brand}\\b`, 'i').test(message)) {
      entities.brand = brand === 'iphone' ? 'Apple' : brand.charAt(0).toUpperCase() + brand.slice(1);
      break;
    }
  }

  // Extract SIM type
  if (/esim|e-sim|electronic\s*sim/i.test(message)) {
    entities.simType = 'ESIM';
  } else if (/psim|p-sim|physical\s*sim|physical\s*sim\s*card/i.test(message)) {
    entities.simType = 'PSIM';
  }

  // Extract max price
  const priceMatch = message.match(/(?:under|below|less\s*than|max|maximum)\s*\$?(\d+)/i);
  if (priceMatch) {
    entities.maxPrice = parseFloat(priceMatch[1]);
  }

  // Extract action for edit operations
  if (/remove|delete/i.test(message)) {
    entities.action = 'remove';
  } else if (/change|switch|replace|update/i.test(message)) {
    entities.action = 'change';
  }

  // Extract item type for edit operations
  if (/plan/i.test(message) && entities.action) {
    entities.itemType = 'plan';
  } else if (/device|phone/i.test(message) && entities.action) {
    entities.itemType = 'device';
  } else if (/protection|insurance/i.test(message) && entities.action) {
    entities.itemType = 'protection';
  } else if (/sim/i.test(message) && entities.action) {
    entities.itemType = 'sim';
  }

  // Clean up empty arrays
  if (entities.lineNumbers.length === 0) {
    delete entities.lineNumbers;
  }

  // Remove null values
  const cleaned = {};
  for (const [key, value] of Object.entries(entities)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

/**
 * Normalize intent name
 * @param {string} intent - Intent name
 * @returns {string} Normalized intent
 */
export function normalizeIntent(intent) {
  if (!intent) return INTENT_TYPES.OTHER;
  
  const normalized = intent.toLowerCase().trim();
  
  // Map variations to standard intents
  const intentMap = {
    'coverage': INTENT_TYPES.COVERAGE,
    'plan': INTENT_TYPES.PLAN,
    'plans': INTENT_TYPES.PLAN,
    'device': INTENT_TYPES.DEVICE,
    'devices': INTENT_TYPES.DEVICE,
    'protection': INTENT_TYPES.PROTECTION,
    'checkout': INTENT_TYPES.CHECKOUT,
    'proceed': INTENT_TYPES.CHECKOUT,
    'edit': INTENT_TYPES.EDIT,
    'sim': INTENT_TYPES.SIM,
    'line_count': INTENT_TYPES.LINE_COUNT,
    'lines': INTENT_TYPES.LINE_COUNT
  };

  return intentMap[normalized] || INTENT_TYPES.OTHER;
}

