import { callReachAPI } from "./apiClient.js";
import { logger } from "../utils/logger.js";

/**
 * Normalize ZIP code by removing extended format (e.g., "07008-2668" -> "07008")
 */
function normalizeZipCode(zipCode) {
  if (!zipCode) return zipCode;
  // Remove extended format (everything after the dash)
  return zipCode.split('-')[0].trim();
}

/**
 * Get US state from ZIP code (using first 3 digits)
 * This mapping covers the most common ZIP code ranges by state
 */
function getStateFromZipCode(zipCode) {
  if (!zipCode) return "NY"; // Default fallback
  
  const zip = normalizeZipCode(zipCode);
  if (!zip || zip.length < 3) return "NY";
  
  const first3 = zip.substring(0, 3);
  const num = parseInt(first3, 10);
  
  // Comprehensive ZIP code to state mapping
  // ZIP codes are assigned in ranges by state
  if (num >= 100 && num <= 149) return "NY"; // New York: 100-149
  if (num >= 700 && num <= 899) {
    if (num >= 700 && num <= 701) return "LA"; // Louisiana
    if (num >= 703 && num <= 704) return "LA";
    if (num >= 705 && num <= 714) return "LA";
    if (num >= 716 && num <= 717) return "AR"; // Arkansas
    if (num >= 718 && num <= 719) return "AR";
    if (num >= 720 && num <= 722) return "AR";
    if (num >= 723 && num <= 729) return "AR";
    if (num >= 730 && num <= 731) return "OK"; // Oklahoma
    if (num >= 733 && num <= 799) return "TX"; // Texas
    if (num >= 800 && num <= 816) return "CO"; // Colorado
    if (num >= 820 && num <= 831) return "WY"; // Wyoming
    if (num >= 832 && num <= 838) return "ID"; // Idaho
    if (num >= 840 && num <= 847) return "UT"; // Utah
    if (num >= 850 && num <= 865) return "AZ"; // Arizona
    if (num >= 870 && num <= 884) return "NM"; // New Mexico
    if (num >= 889 && num <= 899) return "NV"; // Nevada
  }
  if (num >= 900 && num <= 966) return "CA"; // California
  if (num >= 967 && num <= 968) return "HI"; // Hawaii
  if (num >= 969 && num <= 969) return "GU"; // Guam
  if (num >= 970 && num <= 979) return "OR"; // Oregon
  if (num >= 980 && num <= 994) return "WA"; // Washington
  if (num >= 995 && num <= 999) return "AK"; // Alaska
  
  // Specific mappings for common ZIP code ranges
  const stateMap = {
    // New Jersey: 070-089
    '070': 'NJ', '071': 'NJ', '072': 'NJ', '073': 'NJ', '074': 'NJ',
    '075': 'NJ', '076': 'NJ', '077': 'NJ', '078': 'NJ', '079': 'NJ',
    '080': 'NJ', '081': 'NJ', '082': 'NJ', '083': 'NJ', '084': 'NJ',
    '085': 'NJ', '086': 'NJ', '087': 'NJ', '088': 'NJ', '089': 'NJ',
    
    // Pennsylvania: 150-199
    '150': 'PA', '151': 'PA', '152': 'PA', '153': 'PA', '154': 'PA',
    '155': 'PA', '156': 'PA', '157': 'PA', '158': 'PA', '159': 'PA',
    '160': 'PA', '161': 'PA', '162': 'PA', '163': 'PA', '164': 'PA',
    '165': 'PA', '166': 'PA', '167': 'PA', '168': 'PA', '169': 'PA',
    '170': 'PA', '171': 'PA', '172': 'PA', '173': 'PA', '174': 'PA',
    '175': 'PA', '176': 'PA', '177': 'PA', '178': 'PA', '179': 'PA',
    '180': 'PA', '181': 'PA', '182': 'PA', '183': 'PA', '184': 'PA',
    '185': 'PA', '186': 'PA', '187': 'PA', '188': 'PA', '189': 'PA',
    '190': 'PA', '191': 'PA', '192': 'PA', '193': 'PA', '194': 'PA',
    '195': 'PA', '196': 'PA', '197': 'PA', '198': 'PA', '199': 'PA',
    
    // Delaware: 197-199 (overlaps with PA)
    '197': 'DE', '198': 'DE', '199': 'DE',
    
    // Maryland: 206-219
    '206': 'MD', '207': 'MD', '208': 'MD', '209': 'MD', '210': 'MD',
    '211': 'MD', '212': 'MD', '214': 'MD', '215': 'MD', '216': 'MD',
    '217': 'MD', '218': 'MD', '219': 'MD',
    
    // Virginia: 201-246
    '201': 'VA', '220': 'VA', '221': 'VA', '222': 'VA', '223': 'VA',
    '224': 'VA', '225': 'VA', '226': 'VA', '227': 'VA', '228': 'VA',
    '229': 'VA', '230': 'VA', '231': 'VA', '232': 'VA', '233': 'VA',
    '234': 'VA', '235': 'VA', '236': 'VA', '237': 'VA', '238': 'VA',
    '239': 'VA', '240': 'VA', '241': 'VA', '242': 'VA', '243': 'VA',
    '244': 'VA', '245': 'VA', '246': 'VA',
    
    // West Virginia: 247-268
    '247': 'WV', '248': 'WV', '249': 'WV', '250': 'WV', '251': 'WV',
    '252': 'WV', '253': 'WV', '254': 'WV', '255': 'WV', '256': 'WV',
    '257': 'WV', '258': 'WV', '259': 'WV', '260': 'WV', '261': 'WV',
    '262': 'WV', '263': 'WV', '264': 'WV', '265': 'WV', '266': 'WV',
    '267': 'WV', '268': 'WV',
    
    // North Carolina: 270-289
    '270': 'NC', '271': 'NC', '272': 'NC', '273': 'NC', '274': 'NC',
    '275': 'NC', '276': 'NC', '277': 'NC', '278': 'NC', '279': 'NC',
    '280': 'NC', '281': 'NC', '282': 'NC', '283': 'NC', '284': 'NC',
    '285': 'NC', '286': 'NC', '287': 'NC', '288': 'NC', '289': 'NC',
    
    // South Carolina: 290-299
    '290': 'SC', '291': 'SC', '292': 'SC', '293': 'SC', '294': 'SC',
    '295': 'SC', '296': 'SC', '297': 'SC', '298': 'SC', '299': 'SC',
    
    // Georgia: 300-319
    '300': 'GA', '301': 'GA', '302': 'GA', '303': 'GA', '304': 'GA',
    '305': 'GA', '306': 'GA', '307': 'GA', '308': 'GA', '309': 'GA',
    '310': 'GA', '311': 'GA', '312': 'GA', '313': 'GA', '314': 'GA',
    '315': 'GA', '316': 'GA', '317': 'GA', '318': 'GA', '319': 'GA',
    
    // Florida: 320-349
    '320': 'FL', '321': 'FL', '322': 'FL', '323': 'FL', '324': 'FL',
    '325': 'FL', '326': 'FL', '327': 'FL', '328': 'FL', '329': 'FL',
    '330': 'FL', '331': 'FL', '332': 'FL', '333': 'FL', '334': 'FL',
    '335': 'FL', '336': 'FL', '337': 'FL', '338': 'FL', '339': 'FL',
    '340': 'FL', '341': 'FL', '342': 'FL', '344': 'FL', '346': 'FL',
    '347': 'FL', '349': 'FL',
    
    // Alabama: 350-369
    '350': 'AL', '351': 'AL', '352': 'AL', '354': 'AL', '355': 'AL',
    '356': 'AL', '357': 'AL', '358': 'AL', '359': 'AL', '360': 'AL',
    '361': 'AL', '362': 'AL', '363': 'AL', '364': 'AL', '365': 'AL',
    '366': 'AL', '367': 'AL', '368': 'AL', '369': 'AL',
    
    // Mississippi: 386-397
    '386': 'MS', '387': 'MS', '388': 'MS', '389': 'MS', '390': 'MS',
    '391': 'MS', '392': 'MS', '393': 'MS', '394': 'MS', '395': 'MS',
    '396': 'MS', '397': 'MS',
    
    // Tennessee: 370-385
    '370': 'TN', '371': 'TN', '372': 'TN', '373': 'TN', '374': 'TN',
    '375': 'TN', '376': 'TN', '377': 'TN', '378': 'TN', '379': 'TN',
    '380': 'TN', '381': 'TN', '382': 'TN', '383': 'TN', '384': 'TN',
    '385': 'TN',
    
    // Kentucky: 400-427
    '400': 'KY', '402': 'KY', '403': 'KY', '404': 'KY', '405': 'KY',
    '406': 'KY', '407': 'KY', '408': 'KY', '409': 'KY', '410': 'KY',
    '411': 'KY', '412': 'KY', '413': 'KY', '414': 'KY', '415': 'KY',
    '416': 'KY', '417': 'KY', '418': 'KY', '420': 'KY', '421': 'KY',
    '422': 'KY', '423': 'KY', '424': 'KY', '425': 'KY', '426': 'KY',
    '427': 'KY',
    
    // Ohio: 430-459
    '430': 'OH', '431': 'OH', '432': 'OH', '433': 'OH', '434': 'OH',
    '435': 'OH', '436': 'OH', '437': 'OH', '438': 'OH', '439': 'OH',
    '440': 'OH', '441': 'OH', '442': 'OH', '443': 'OH', '444': 'OH',
    '445': 'OH', '446': 'OH', '447': 'OH', '448': 'OH', '449': 'OH',
    '450': 'OH', '451': 'OH', '452': 'OH', '453': 'OH', '454': 'OH',
    '455': 'OH', '456': 'OH', '457': 'OH', '458': 'OH', '459': 'OH',
    
    // Indiana: 460-479
    '460': 'IN', '461': 'IN', '462': 'IN', '463': 'IN', '464': 'IN',
    '465': 'IN', '466': 'IN', '467': 'IN', '468': 'IN', '469': 'IN',
    '470': 'IN', '471': 'IN', '472': 'IN', '473': 'IN', '474': 'IN',
    '475': 'IN', '476': 'IN', '477': 'IN', '478': 'IN', '479': 'IN',
    
    // Illinois: 600-629
    '600': 'IL', '601': 'IL', '602': 'IL', '603': 'IL', '604': 'IL',
    '605': 'IL', '606': 'IL', '607': 'IL', '608': 'IL', '609': 'IL',
    '610': 'IL', '611': 'IL', '612': 'IL', '613': 'IL', '614': 'IL',
    '615': 'IL', '616': 'IL', '617': 'IL', '618': 'IL', '619': 'IL',
    '620': 'IL', '622': 'IL', '623': 'IL', '624': 'IL', '625': 'IL',
    '626': 'IL', '627': 'IL', '628': 'IL', '629': 'IL',
    
    // Michigan: 480-499
    '480': 'MI', '481': 'MI', '482': 'MI', '483': 'MI', '484': 'MI',
    '485': 'MI', '486': 'MI', '487': 'MI', '488': 'MI', '489': 'MI',
    '490': 'MI', '491': 'MI', '492': 'MI', '493': 'MI', '494': 'MI',
    '495': 'MI', '496': 'MI', '497': 'MI', '498': 'MI', '499': 'MI',
    
    // Wisconsin: 530-549
    '530': 'WI', '531': 'WI', '532': 'WI', '534': 'WI', '535': 'WI',
    '537': 'WI', '538': 'WI', '539': 'WI', '540': 'WI', '541': 'WI',
    '542': 'WI', '543': 'WI', '544': 'WI', '545': 'WI', '546': 'WI',
    '547': 'WI', '548': 'WI', '549': 'WI',
    
    // Minnesota: 550-569
    '550': 'MN', '551': 'MN', '553': 'MN', '554': 'MN', '555': 'MN',
    '556': 'MN', '557': 'MN', '558': 'MN', '559': 'MN', '560': 'MN',
    '561': 'MN', '562': 'MN', '563': 'MN', '564': 'MN', '565': 'MN',
    '566': 'MN', '567': 'MN', '568': 'MN', '569': 'MN',
    
    // Iowa: 500-529
    '500': 'IA', '501': 'IA', '502': 'IA', '503': 'IA', '504': 'IA',
    '505': 'IA', '506': 'IA', '507': 'IA', '508': 'IA', '510': 'IA',
    '511': 'IA', '512': 'IA', '513': 'IA', '514': 'IA', '515': 'IA',
    '516': 'IA', '520': 'IA', '521': 'IA', '522': 'IA', '523': 'IA',
    '524': 'IA', '525': 'IA', '526': 'IA', '527': 'IA', '528': 'IA',
    
    // Missouri: 630-659
    '630': 'MO', '631': 'MO', '633': 'MO', '634': 'MO', '635': 'MO',
    '636': 'MO', '637': 'MO', '638': 'MO', '639': 'MO', '640': 'MO',
    '641': 'MO', '644': 'MO', '645': 'MO', '646': 'MO', '647': 'MO',
    '648': 'MO', '650': 'MO', '651': 'MO', '652': 'MO', '653': 'MO',
    '654': 'MO', '655': 'MO', '656': 'MO', '657': 'MO', '658': 'MO',
    
    // North Dakota: 580-588
    '580': 'ND', '581': 'ND', '582': 'ND', '583': 'ND', '584': 'ND',
    '585': 'ND', '586': 'ND', '587': 'ND', '588': 'ND',
    
    // South Dakota: 570-577
    '570': 'SD', '571': 'SD', '572': 'SD', '573': 'SD', '574': 'SD',
    '575': 'SD', '576': 'SD', '577': 'SD',
    
    // Nebraska: 680-693
    '680': 'NE', '681': 'NE', '683': 'NE', '684': 'NE', '685': 'NE',
    '686': 'NE', '687': 'NE', '688': 'NE', '689': 'NE', '690': 'NE',
    '691': 'NE', '692': 'NE', '693': 'NE',
    
    // Kansas: 660-679
    '660': 'KS', '661': 'KS', '662': 'KS', '664': 'KS', '665': 'KS',
    '666': 'KS', '667': 'KS', '668': 'KS', '669': 'KS', '670': 'KS',
    '671': 'KS', '672': 'KS', '673': 'KS', '674': 'KS', '675': 'KS',
    '676': 'KS', '677': 'KS', '678': 'KS', '679': 'KS',
    
    // Rhode Island: 028-029
    '028': 'RI', '029': 'RI',
    
    // Massachusetts: 010-027
    '010': 'MA', '011': 'MA', '012': 'MA', '013': 'MA', '014': 'MA',
    '015': 'MA', '016': 'MA', '017': 'MA', '018': 'MA', '019': 'MA',
    '020': 'MA', '021': 'MA', '022': 'MA', '023': 'MA', '024': 'MA',
    '025': 'MA', '026': 'MA', '027': 'MA',
    
    // Connecticut: 060-069
    '060': 'CT', '061': 'CT', '062': 'CT', '063': 'CT', '064': 'CT',
    '065': 'CT', '066': 'CT', '067': 'CT', '068': 'CT', '069': 'CT',
    
    // Vermont: 050-059
    '050': 'VT', '051': 'VT', '052': 'VT', '053': 'VT', '054': 'VT',
    '055': 'VT', '056': 'VT', '057': 'VT', '058': 'VT', '059': 'VT',
    
    // New Hampshire: 030-039
    '030': 'NH', '031': 'NH', '032': 'NH', '033': 'NH', '034': 'NH',
    '035': 'NH', '036': 'NH', '037': 'NH', '038': 'NH', '039': 'NH',
    
    // Maine: 039-049
    '039': 'ME', '040': 'ME', '041': 'ME', '042': 'ME', '043': 'ME',
    '044': 'ME', '045': 'ME', '046': 'ME', '047': 'ME', '048': 'ME',
    '049': 'ME',
  };
  
  // Check first 3 digits
  if (stateMap[first3]) {
    return stateMap[first3];
  }
  
  // Fallback: default to NY if we can't determine
  logger.warn("Could not determine state from ZIP code, using default NY", {
    zipCode,
    normalizedZip: zip,
    first3
  });
  return "NY";
}

export async function checkCoverage(zipCode, tenant = "reach") {
  // Normalize ZIP code (remove extended format if present)
  const normalizedZip = normalizeZipCode(zipCode);
  
  // Determine state from ZIP code instead of hardcoding NY
  const state = getStateFromZipCode(normalizedZip);
  
  logger.debug("Coverage check request", {
    zipCode,
    normalizedZip,
    detectedState: state
  });
  
  // Use the correct coverage endpoint with address format
  // API requires non-null state field, now using detected state
  const requestBody = {
      name: "",
      // API requires non-null address fields, so we send valid defaults
      address1: "Address",
      city: "City",
      state: state, // Use detected state instead of hardcoded NY
      country: "USA",
      zip: normalizedZip,
      street1: ""
  };
  
  try {
    const response = await callReachAPI("/apisvc/v0/network/coverage", {
    method: "POST",
      body: JSON.stringify(requestBody),
  }, tenant);

  // Check if response has a status field - only validate if it exists
  // Some API responses may not have a status field and are successful by default
  if (response.status !== undefined && response.status !== "SUCCESS") {
      // Log full error details for debugging
      logger.error("Coverage API error", {
        zipCode: normalizedZip,
        status: response.status,
        message: response.message,
        data: response.data
      });
    throw new Error(`Coverage check failed: ${response.message || "Unknown error"}`);
  }

  // The API returns data nested under keys like "mno_X" or other carrier codes
  // Extract coverage data from the first available key in response.data
  let coverageData = {};
    
    // Handle different response structures:
    // 1. Response with data field: response.data
    // 2. Response is the data directly: response itself
    // 3. Response has nested keys like "mno_X": response.mno_X or response[firstKey]
    
  if (response.data && typeof response.data === 'object') {
      // Check if data is directly in response.data (not nested)
      if (response.data.msg !== undefined || response.data.signal5g !== undefined || response.data.brandCoverage !== undefined) {
        coverageData = response.data;
      } else {
    // Find the first object key that contains coverage data
    const dataKeys = Object.keys(response.data);
    if (dataKeys.length > 0) {
      coverageData = response.data[dataKeys[0]];
        }
      }
    } else if (response.msg !== undefined || response.signal5g !== undefined || response.brandCoverage !== undefined) {
      // Response itself is the coverage data
      coverageData = response;
    } else {
      // Try to find coverage data in any nested key
      const responseKeys = Object.keys(response);
      const coverageKeys = responseKeys.filter(key => 
        key.toLowerCase().includes('mno') || 
        key.toLowerCase().includes('coverage') ||
        key.toLowerCase().includes('data')
      );
      
      if (coverageKeys.length > 0) {
        coverageData = response[coverageKeys[0]];
      } else if (responseKeys.length > 0 && typeof response[responseKeys[0]] === 'object') {
        // Use first object key as fallback
        coverageData = response[responseKeys[0]];
      } else {
        // Use response as-is if no nested structure found
        coverageData = response;
    }
  }

  // Log the extracted coverage data for debugging
  logger.debug("Coverage data extracted", {
    zipCode: normalizedZip,
    state,
    hasCoverageData: Object.keys(coverageData).length > 0,
    coverageDataKeys: Object.keys(coverageData),
    isValidValue: coverageData.isValid,
    brandCoverageValue: coverageData.brandCoverage
  });
  
  // Map API response fields to expected format
  // More conservative default: only show as valid if we have actual positive data
  const isValid = coverageData.isValid !== undefined 
    ? coverageData.isValid 
    : (coverageData.brandCoverage === true ? true : null); // null = unknown, not false
  
  return {
    zipCode,
    isValid,
    brandCoverage: coverageData.brandCoverage !== undefined ? coverageData.brandCoverage : null,
    // Map coverageStrength5G/4G to signal5g/signal4g
    signal5g: coverageData.coverageStrength5G || coverageData.signal5g || null,
    signal4g: coverageData.coverageStrength4G || coverageData.signal4g || null,
    // SIM Availability
    esimAvailable: coverageData.esimAvailable !== undefined ? coverageData.esimAvailable : (response.data?.esimAvailable !== undefined ? response.data.esimAvailable : null),
    psimAvailable: coverageData.psimAvailable !== undefined ? coverageData.psimAvailable : (response.data?.psimAvailable !== undefined ? response.data.psimAvailable : null),
    // Network Compatibility
    compatibility5G: coverageData.compatibility5G !== undefined ? coverageData.compatibility5G : (coverageData.compatibility5g !== undefined ? coverageData.compatibility5g : (response.data?.compatibility5G !== undefined ? response.data.compatibility5G : (response.data?.compatibility5g !== undefined ? response.data.compatibility5g : null))),
    compatibility4G: coverageData.compatibility4G !== undefined ? coverageData.compatibility4G : (coverageData.compatibility4g !== undefined ? coverageData.compatibility4g : (coverageData.lteCompatible !== undefined ? coverageData.lteCompatible : (response.data?.compatibility4G !== undefined ? response.data.compatibility4G : (response.data?.compatibility4g !== undefined ? response.data.compatibility4g : null)))),
    volteCompatible: coverageData.volteCompatible !== undefined ? coverageData.volteCompatible : (response.data?.volteCompatible !== undefined ? response.data.volteCompatible : null),
    wfcCompatible: coverageData.wfcCompatible !== undefined ? coverageData.wfcCompatible : (response.data?.wfcCompatible !== undefined ? response.data.wfcCompatible : null),
    // Additional API fields
    errorText: coverageData.errorText || response.data?.errorText || null,
    mode: coverageData.mode || response.data?.mode || null,
    wifiCalling: coverageData.wifiCalling || response.data?.wifiCalling || null,
    cdmaLess: coverageData.cdmaLess || response.data?.cdmaLess || null,
    hdVoice: coverageData.hdVoice || response.data?.hdVoice || null,
    lostOrStolen: coverageData.lostOrStolen || response.data?.lostOrStolen || null,
    inProgress: coverageData.inProgress !== undefined ? coverageData.inProgress : (response.data?.inProgress !== undefined ? response.data.inProgress : null),
    isLocked: coverageData.isLocked || response.data?.isLocked || null,
    filteredDevice: coverageData.filteredDevice || response.data?.filteredDevice || null,
    compatibleFuture: coverageData.compatibleFuture !== undefined ? coverageData.compatibleFuture : (response.data?.compatibleFuture !== undefined ? response.data.compatibleFuture : null),
    refNumbers: coverageData.refNumbers || response.data?.refNumbers || [],
    preLoadedValid: coverageData.preLoadedValid !== undefined ? coverageData.preLoadedValid : (response.data?.preLoadedValid !== undefined ? response.data.preLoadedValid : null),
    tradeInEnable: coverageData.tradeInEnable !== undefined ? coverageData.tradeInEnable : (response.data?.tradeInEnable !== undefined ? response.data.tradeInEnable : null),
    fiberValid: coverageData.fiberValid !== undefined ? coverageData.fiberValid : (response.data?.fiberValid !== undefined ? response.data.fiberValid : null),
    msg: coverageData.msg || response.data?.msg || null,
    // Include all original data for backward compatibility
    ...response.data,
    ...coverageData,
  };
  } catch (error) {
    // Enhanced error logging
    logger.error("Coverage check failed", {
      zipCode: normalizedZip,
      error: error.message,
      statusCode: error.statusCode,
      errorType: error.errorType,
      responseBody: error.responseBody
    });
    
    // Provide more helpful error message for 403
    if (error.statusCode === 403) {
      const errorDetails = error.responseBody || {};
      const errorMessage = errorDetails.Message || errorDetails.message || error.message;
      
      // Check if it's an explicit deny policy issue
      if (errorMessage && errorMessage.includes('explicit deny')) {
        logger.error("Coverage API: Explicit deny policy detected", {
          zipCode: normalizedZip,
          errorMessage,
          endpoint: "/apisvc/v0/network/coverage",
          suggestion: "Account needs coverage endpoint permissions from Reach support"
        });
        
        throw new Error(
          `Coverage check unavailable: Your account has an explicit deny policy for the coverage endpoint. ` +
          `This is a permissions issue that needs to be resolved with Reach support. ` +
          `Please contact Reach support to request access to /apisvc/v0/network/coverage endpoint. ` +
          `In the meantime, you can proceed with plan selection without a coverage check.`
        );
      }
      
      throw new Error(
        `Coverage API access denied (403). ` +
        `This account may not have permission to access /apisvc/v0/network/coverage. ` +
        `Please verify API permissions with Reach support. Error: ${errorMessage}`
      );
    }
    
    throw error;
  }
}

