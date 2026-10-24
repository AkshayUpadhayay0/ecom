import type {
  BlueprintRequirementsDto,
  DecisionDto,
  RecommendationDto,
  SelectionMode,
} from '@urban-ibile/shared';
import { parseAllMeasurements, type MeasurementErrors } from './measurement-input';

/**
 * The Find My Size flow as a pure state machine (the dialog only renders it and performs the
 * network calls it asks for). The size itself is never computed here: the recommendation comes
 * from the API preview and the final decision is re-computed and stored by the API.
 */
export type FitInput =
  | { method: 'MANUAL_MEASUREMENTS'; measurements: Record<string, number> }
  | { method: 'BODY_SCAN'; bodyScanSessionId: string };

export type Step =
  | 'closed'
  | 'loading' // fetching the requirements
  | 'measuring'
  | 'scanning'
  | 'previewing'
  | 'review'
  | 'saving'
  | 'done';

export interface FlowState {
  step: Step;
  requirements: BlueprintRequirementsDto | null;
  /** What the shopper typed, by measurement code. */
  texts: Record<string, string>;
  errors: MeasurementErrors;
  fitPreference: string;
  /** The input that produced the current recommendation (sent again with the decision). */
  input: FitInput | null;
  recommendation: RecommendationDto | null;
  /** RECOMMENDED = accept the computed size; '' = nothing chosen yet; otherwise a size id (OVERRIDE). */
  choice: string;
  decision: DecisionDto | null;
  /** Last failure (BffError-like code) to show above the current step. */
  failure: { code: string; details?: unknown } | null;
}

/** choice value for accepting the recommended size. */
export const RECOMMENDED = 'recommended';

export const initialState: FlowState = {
  step: 'closed',
  requirements: null,
  texts: {},
  errors: {},
  fitPreference: '',
  input: null,
  recommendation: null,
  choice: RECOMMENDED,
  decision: null,
  failure: null,
};

export type Event =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'requirements_loaded'; requirements: BlueprintRequirementsDto }
  | { type: 'requirements_failed'; failure: { code: string; details?: unknown } }
  | { type: 'type'; code: string; text: string }
  | { type: 'set_fit'; fitPreference: string }
  | { type: 'submit_measurements' }
  | { type: 'start_scan' }
  | { type: 'scan_ready'; bodyScanSessionId: string }
  | { type: 'scan_failed'; failure: { code: string; details?: unknown } }
  | { type: 'preview_ok'; recommendation: RecommendationDto }
  | { type: 'preview_failed'; failure: { code: string; details?: unknown } }
  | { type: 'choose'; choice: string }
  | { type: 'edit_measurements' }
  | { type: 'save' }
  | { type: 'save_ok'; decision: DecisionDto }
  | { type: 'save_failed'; failure: { code: string; details?: unknown } };

export function reduce(state: FlowState, event: Event): FlowState {
  switch (event.type) {
    case 'open':
      if (state.step !== 'closed' && state.step !== 'done') return state;
      return state.requirements
        ? { ...state, step: 'measuring', failure: null, decision: null, errors: {} }
        : { ...state, step: 'loading', failure: null, decision: null };
    case 'close':
      return { ...state, step: 'closed', failure: null, errors: {} };
    case 'requirements_loaded':
      return {
        ...state,
        step: 'measuring',
        requirements: event.requirements,
        fitPreference: state.fitPreference || (event.requirements.fitOptions[0]?.code ?? ''),
        failure: null,
      };
    case 'requirements_failed':
      return { ...state, step: 'measuring', failure: event.failure };
    case 'type': {
      const { [event.code]: _cleared, ...errors } = state.errors;
      return { ...state, texts: { ...state.texts, [event.code]: event.text }, errors };
    }
    case 'set_fit':
      return { ...state, fitPreference: event.fitPreference };
    case 'submit_measurements': {
      if (state.step !== 'measuring' || !state.requirements) return state;
      const parsed = parseAllMeasurements(state.requirements.measurements, state.texts);
      if (!parsed.ok) return { ...state, errors: parsed.errors, failure: null };
      return {
        ...state,
        step: 'previewing',
        errors: {},
        failure: null,
        input: { method: 'MANUAL_MEASUREMENTS', measurements: parsed.values },
      };
    }
    case 'start_scan':
      return state.step === 'measuring' ? { ...state, step: 'scanning', failure: null } : state;
    case 'scan_ready':
      return {
        ...state,
        step: 'previewing',
        failure: null,
        input: { method: 'BODY_SCAN', bodyScanSessionId: event.bodyScanSessionId },
      };
    case 'scan_failed':
      return { ...state, step: 'measuring', failure: event.failure };
    case 'preview_ok':
      return {
        ...state,
        step: 'review',
        recommendation: event.recommendation,
        // An offered recommendation is pre-selected; if the outfit is not made in that size the
        // shopper must pick another one before continuing.
        choice: event.recommendation.recommendedOffered ? RECOMMENDED : '',
        failure: null,
      };
    case 'preview_failed':
      return { ...state, step: 'measuring', input: null, failure: event.failure };
    case 'choose':
      return state.step === 'review' ? { ...state, choice: event.choice, failure: null } : state;
    case 'edit_measurements':
      return { ...state, step: 'measuring', recommendation: null, failure: null };
    case 'save':
      return state.step === 'review' && state.choice !== ''
        ? { ...state, step: 'saving', failure: null }
        : state;
    case 'save_ok':
      return { ...state, step: 'done', decision: event.decision, failure: null };
    case 'save_failed':
      return { ...state, step: 'review', failure: event.failure };
    default:
      return state;
  }
}

export interface DecisionRequestBody {
  productId: string;
  method: FitInput['method'];
  fitPreference: string;
  measurements?: Record<string, number>;
  bodyScanSessionId?: string;
  selectionMode: SelectionMode;
  chosenSizeId?: string;
}

/** Body of POST /blueprint/recommendations (preview). */
export function previewBody(productId: string, fitPreference: string, input: FitInput) {
  return input.method === 'MANUAL_MEASUREMENTS'
    ? { productId, method: input.method, fitPreference, measurements: input.measurements }
    : {
        productId,
        method: input.method,
        fitPreference,
        bodyScanSessionId: input.bodyScanSessionId,
      };
}

/**
 * Body of POST /blueprint/decisions. LOCKED_RECOMMENDATION sends the recommended size id only as
 * the API requires it to match; the server recomputes everything and ignores client opinions.
 */
export function decisionBody(productId: string, state: FlowState): DecisionRequestBody | null {
  if (!state.input || !state.recommendation || state.choice === '') return null;
  const accepted = state.choice === RECOMMENDED;
  return {
    ...previewBody(productId, state.fitPreference, state.input),
    selectionMode: accepted ? 'LOCKED_RECOMMENDATION' : 'OVERRIDE',
    chosenSizeId: accepted ? state.recommendation.recommendedSize.id : state.choice,
  };
}
