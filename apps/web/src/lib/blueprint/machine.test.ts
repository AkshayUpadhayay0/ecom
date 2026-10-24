import type { BlueprintRequirementsDto, DecisionDto, RecommendationDto } from '@urban-ibile/shared';
import { describe, expect, it } from 'vitest';
import {
  decisionBody,
  initialState,
  previewBody,
  reduce,
  type Event,
  type FlowState,
} from './machine';

const requirements: BlueprintRequirementsDto = {
  productId: 'p1',
  required: true,
  profile: { code: 'male_top', name: 'Male top' },
  unit: 'in',
  measurements: [
    { code: 'chest', label: 'Chest', helpText: null, unit: 'in', minInches: 5, maxInches: 90 },
    {
      code: 'shoulder',
      label: 'Shoulder',
      helpText: null,
      unit: 'in',
      minInches: 5,
      maxInches: 90,
    },
  ],
  fitOptions: [
    { code: 'tailored', label: 'Tailored' },
    { code: 'standard', label: 'Standard' },
  ],
  bodyScan: { available: true, mocked: true },
};

const recommendation: RecommendationDto = {
  productId: 'p1',
  method: 'MANUAL_MEASUREMENTS',
  fitPreference: 'tailored',
  recommendedSize: { id: 'size-l', code: 'L', label: 'Large' },
  recommendedOffered: true,
  recommendedInStock: true,
  breakdown: [],
  alternatives: [{ id: 'size-xl', code: 'XL', label: 'Extra Large', availability: 'in_stock' }],
  boundaryRule: 'SMALLEST_COVERING_SIZE',
  mocked: false,
};

const decision = { id: 'd1' } as DecisionDto;

function run(events: Event[], from: FlowState = initialState): FlowState {
  return events.reduce(reduce, from);
}

const toMeasuring: Event[] = [{ type: 'open' }, { type: 'requirements_loaded', requirements }];

describe('Find My Size state machine', () => {
  it('opens, loads requirements and defaults the fit preference to the first option', () => {
    const loading = run([{ type: 'open' }]);
    expect(loading.step).toBe('loading');
    const state = run(toMeasuring);
    expect(state.step).toBe('measuring');
    expect(state.fitPreference).toBe('tailored');
  });

  it('keeps the requirements when reopened (no second fetch)', () => {
    const closed = run([...toMeasuring, { type: 'close' }]);
    expect(run([{ type: 'open' }], closed).step).toBe('measuring');
  });

  it('refuses to preview with missing or malformed measurements and flags each field', () => {
    const state = run([
      ...toMeasuring,
      { type: 'type', code: 'chest', text: '42.55' },
      { type: 'submit_measurements' },
    ]);
    expect(state.step).toBe('measuring');
    expect(state.errors.chest?.error).toBe('fms.measure.error.decimals');
    expect(state.errors.shoulder?.error).toBe('fms.measure.error.required');
  });

  it("typing clears that field's error only", () => {
    const state = run([
      ...toMeasuring,
      { type: 'submit_measurements' },
      { type: 'type', code: 'chest', text: '42' },
    ]);
    expect(state.errors.chest).toBeUndefined();
    expect(state.errors.shoulder).toBeDefined();
  });

  it('goes to preview with parsed inches, then review with the recommendation pre-accepted', () => {
    const state = run([
      ...toMeasuring,
      { type: 'type', code: 'chest', text: '42' },
      { type: 'type', code: 'shoulder', text: '17,5' },
      { type: 'submit_measurements' },
    ]);
    expect(state.step).toBe('previewing');
    expect(state.input).toEqual({
      method: 'MANUAL_MEASUREMENTS',
      measurements: { chest: 42, shoulder: 17.5 },
    });
    const review = reduce(state, { type: 'preview_ok', recommendation });
    expect(review.step).toBe('review');
    expect(review.choice).toBe('recommended');
  });

  it('returns to measuring with the failure when the preview is refused (out of range)', () => {
    const previewing = run([
      ...toMeasuring,
      { type: 'type', code: 'chest', text: '54' },
      { type: 'type', code: 'shoulder', text: '17' },
      { type: 'submit_measurements' },
    ]);
    const failed = reduce(previewing, {
      type: 'preview_failed',
      failure: { code: 'BLUEPRINT_OUT_OF_RANGE' },
    });
    expect(failed.step).toBe('measuring');
    expect(failed.failure?.code).toBe('BLUEPRINT_OUT_OF_RANGE');
    expect(failed.texts.chest).toBe('54'); // what was typed is kept
  });

  it('forces a choice when the outfit is not made in the recommended size', () => {
    const review = run([
      ...toMeasuring,
      { type: 'type', code: 'chest', text: '42' },
      { type: 'type', code: 'shoulder', text: '17' },
      { type: 'submit_measurements' },
      { type: 'preview_ok', recommendation: { ...recommendation, recommendedOffered: false } },
    ]);
    expect(review.choice).toBe('');
    expect(reduce(review, { type: 'save' }).step).toBe('review'); // cannot save without a choice
  });

  function review(): FlowState {
    return run([
      ...toMeasuring,
      { type: 'type', code: 'chest', text: '42' },
      { type: 'type', code: 'shoulder', text: '17' },
      { type: 'submit_measurements' },
      { type: 'preview_ok', recommendation },
    ]);
  }

  it('accept -> LOCKED_RECOMMENDATION, other size -> OVERRIDE (server decides everything else)', () => {
    const accepted = review();
    expect(decisionBody('p1', accepted)).toMatchObject({
      selectionMode: 'LOCKED_RECOMMENDATION',
      chosenSizeId: 'size-l',
      method: 'MANUAL_MEASUREMENTS',
      measurements: { chest: 42, shoulder: 17 },
      fitPreference: 'tailored',
    });
    const overridden = reduce(accepted, { type: 'choose', choice: 'size-xl' });
    expect(decisionBody('p1', overridden)).toMatchObject({
      selectionMode: 'OVERRIDE',
      chosenSizeId: 'size-xl',
    });
  });

  it('sends no client-computed size: the body has no recommendation field', () => {
    const body = decisionBody('p1', review());
    expect(body).not.toHaveProperty('recommendedSize');
    expect(body).not.toHaveProperty('recommendation');
  });

  it('save -> saving -> done; a failed save returns to review with the failure', () => {
    const saving = reduce(review(), { type: 'save' });
    expect(saving.step).toBe('saving');
    expect(reduce(saving, { type: 'save_ok', decision }).step).toBe('done');
    const failed = reduce(saving, { type: 'save_failed', failure: { code: 'SIZE_NOT_OFFERED' } });
    expect(failed.step).toBe('review');
    expect(failed.failure?.code).toBe('SIZE_NOT_OFFERED');
  });

  it('can go back and change the measurements', () => {
    const state = reduce(review(), { type: 'edit_measurements' });
    expect(state.step).toBe('measuring');
    expect(state.recommendation).toBeNull();
    expect(state.texts.chest).toBe('42');
  });

  it('body scan: scanning -> preview with the session id', () => {
    const scanning = run([...toMeasuring, { type: 'start_scan' }]);
    expect(scanning.step).toBe('scanning');
    const previewing = reduce(scanning, { type: 'scan_ready', bodyScanSessionId: 's1' });
    expect(previewing.step).toBe('previewing');
    expect(
      previewBody(
        'p1',
        'tailored',
        previewing.input ?? { method: 'BODY_SCAN', bodyScanSessionId: '' },
      ),
    ).toEqual({
      productId: 'p1',
      method: 'BODY_SCAN',
      fitPreference: 'tailored',
      bodyScanSessionId: 's1',
    });
    expect(
      reduce(scanning, { type: 'scan_failed', failure: { code: 'BODY_SCAN_NOT_READY' } }).step,
    ).toBe('measuring');
  });

  it('ignores events that do not belong to the current step', () => {
    expect(reduce(initialState, { type: 'save' })).toBe(initialState);
    expect(reduce(initialState, { type: 'submit_measurements' })).toBe(initialState);
  });
});
