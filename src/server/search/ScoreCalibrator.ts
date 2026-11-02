/**
 * Score Calibration & Length-Adaptive Normalization for MCP Tool Search.
 *
 * Grounded in industrial Search/Ads relevance calibration (Platt Scaling &
 * length-adaptive document normalization):
 * - Raw lexical retrieval scores (BM25, TF-IDF, RRF) exhibit severe scale
 *   drift across query lengths: single-word exact queries produce modest raw
 *   scores (3-5), whereas multi-word queries aggregate serendipitous token
 *   matches into large raw scores (15-30).
 * - A static absolute score threshold (e.g. score < 10) mistakenly rejects
 *   valid single-word queries while leaking multi-word noise.
 * - ScoreCalibrator normalizes raw scores against effective query token
 *   complexity and maps them via logistic calibration onto a posterior
 *   confidence probability C in [0, 1].
 */

/** Midpoint threshold of normalized relevance for sigmoid transition. */
const CALIBRATION_MIDPOINT = 1.65;

/** Temperature scaling parameter controlling calibration curve steepness. */
const CALIBRATION_SCALE = 0.95;

/** Default minimal posterior confidence required to pass out-of-domain gate. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.25;

/**
 * Computes effective content query length after filtering degenerate tokens.
 */
function calculateEffectiveLength(contentTokens: readonly string[]): number {
  return Math.max(1, contentTokens.length);
}

/**
 * Sub-linear length normalization factor D(L).
 *
 * Mirrors BM25 length dampening and Lucene field-norm principles:
 * D(L) = sqrt(L) * (1.0 + 0.28 * ln(L))
 *
 * Ensures single-word queries (L=1 => D=1.0) preserve their raw score,
 * while multi-word queries (L=5 => D~3.2) are dampened proportionally
 * to their token count to prevent accidental match accumulation.
 */
function lengthNormalizationFactor(effectiveLength: number): number {
  if (effectiveLength <= 1) return 1.0;
  return Math.sqrt(effectiveLength) * (1.0 + 0.28 * Math.log(effectiveLength));
}

/**
 * Normalizes a raw retrieval score by query length factor.
 */
function normalizeRawScore(rawScore: number, effectiveLength: number): number {
  if (rawScore <= 0) return 0;
  const factor = lengthNormalizationFactor(effectiveLength);
  return rawScore / factor;
}

/**
 * Maps a raw score and query token count onto a calibrated posterior
 * confidence probability in [0, 1] using logistic sigmoid calibration.
 *
 * P(Relevant | score, L) = 1 / (1 + exp(- (S_norm - midpoint) / scale))
 */
function calibrateConfidence(rawScore: number, effectiveLength: number): number {
  if (rawScore <= 0) return 0.0;
  const normalized = normalizeRawScore(rawScore, effectiveLength);
  const logit = (normalized - CALIBRATION_MIDPOINT) / CALIBRATION_SCALE;

  // Numerical clamp to avoid overflow/underflow
  if (logit > 16) return 1.0;
  if (logit < -16) return 0.0;

  return 1.0 / (1.0 + Math.exp(-logit));
}

/**
 * Decides whether the top retrieved score constitutes a confident match,
 * rejecting out-of-domain noise that fails the posterior confidence floor.
 */
function isConfidentMatch(
  rawScore: number,
  effectiveLength: number,
  threshold = DEFAULT_CONFIDENCE_THRESHOLD,
): boolean {
  const confidence = calibrateConfidence(rawScore, effectiveLength);
  return confidence >= threshold;
}

export const ScoreCalibrator = {
  calculateEffectiveLength,
  lengthNormalizationFactor,
  normalizeRawScore,
  calibrateConfidence,
  isConfidentMatch,
} as const;
