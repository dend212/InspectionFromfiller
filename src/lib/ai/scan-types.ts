/** A single field extracted from a scanned inspection form */
export interface ExtractedField {
  /** Dotted path matching the form data structure, e.g. "facilityInfo.facilityName" */
  fieldPath: string;
  /** The extracted value — string, boolean, or string array depending on field type */
  value: string | boolean | string[];
  /** Confidence score from 0.0 to 1.0 */
  confidence: number;
  /** Description of where on the form the value was found */
  source: string;
}

/** Result returned from the AI scan endpoint */
export interface ScanResult {
  fields: ExtractedField[];
  metadata: {
    pagesProcessed: number;
    totalFieldsExtracted: number;
    processingTimeMs: number;
  };
}

/** Minimum confidence for a field to be auto-selected in the review UI */
export const AUTO_SELECT_CONFIDENCE = 0.8;
