import { screen, waitFor, within } from '@testing-library/react';
import type { ApiList } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import {
  EXPLANATION,
  buildFindings,
  findingSummary,
  findingsByCell,
  formatRange,
} from './chart-warnings';
import { CHARTS, GROUPS, MALE_TOP_CHART, PROFILES, SIZES, VERSIONS } from './sizes.fixtures';

function list<T>(data: T[]): ApiList<T> {
  return { data, meta: { page: 1, pageSize: 50, total: data.length, totalPages: 1 } };
}

const notFound = () =>
  HttpResponse.json(
    { error: { code: 'NOT_FOUND', message: 'Size chart not found.', requestId: 'req-test' } },
    { status: 404 },
  );

/** API contract doubles for the read-only Size Charts endpoints. */
const sizeChartHandlers = [
  http.get(`${API}/admin/sizes`, () => HttpResponse.json(list(SIZES))),
  http.get(`${API}/admin/size-chart-groups`, () => HttpResponse.json(list(GROUPS))),
  http.get(`${API}/admin/size-chart-groups/:groupId/charts`, ({ params }) =>
    HttpResponse.json(list(VERSIONS[String(params.groupId)] ?? [])),
  ),
  http.get(`${API}/admin/size-charts/:chartId`, ({ params }) => {
    const chart = CHARTS[String(params.chartId)];
    return chart ? HttpResponse.json({ data: chart }) : notFound();
  }),
  http.get(`${API}/admin/measurement-profiles`, () => HttpResponse.json(list(PROFILES))),
];

beforeEach(() => {
  apiState.hasSession = true; // signed-in admin (refresh cookie present)
  server.use(...sizeChartHandlers);
});

describe('chart check helpers', () => {
  it('formats ranges, and a single value when min equals max', () => {
    expect(formatRange(38, 40)).toBe('38 – 40 in');
    expect(formatRange(17.5, 18)).toBe('17.5 – 18 in');
    expect(formatRange(33, 33)).toBe('33 in');
  });

  it('counts warnings and notices only, and highlights only their cells', () => {
    expect(findingSummary(MALE_TOP_CHART.check)).toBe('1 warning, 1 notice');
    const byCell = findingsByCell(buildFindings(MALE_TOP_CHART));
    expect([...(byCell.get('L|sleeve') ?? [])]).toEqual(['MAX_TIE']);
    expect([...(byCell.get('XL|sleeve') ?? [])]).toEqual(['MAX_TIE']);
    expect([...(byCell.get('XL|top_length') ?? [])]).toEqual(['MISSING_CELL']);
    // UPPER_LIMIT is info: listed, never highlighted.
    expect(byCell.has('XL|chest')).toBe(false);
    expect(byCell.size).toBe(3);
  });
});

describe('Sizes & Charts section', () => {
  it('is in the sidebar and opens the Size Charts tab on the active version', async () => {
    const { user, router } = renderApp('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: /Sizes & Charts/ }));
    expect(router.state.location.pathname).toBe('/sizes/charts');

    const groupPicker = await screen.findByRole('group', { name: 'Chart group' });
    expect(within(groupPicker).getByRole('button', { name: 'Female' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      within(groupPicker).getByRole('button', { name: 'Male top - Shirt / Kaftan / Agbada inner' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Active charts cannot be edited/)).toBeInTheDocument();
    // Single values are shown as a point, not a range.
    expect(await screen.findByText('33 in')).toBeInTheDocument();
    expect(screen.getByText('25 – 26 in')).toBeInTheDocument();
  });

  it('defaults to the active version, lists every version with status, and has no edit actions', async () => {
    const { user } = renderApp('/sizes/charts?group=male_top');
    const picker = await screen.findByRole('button', { name: 'Chart version 2, Active' });
    expect(await screen.findByText('38 – 40 in')).toBeInTheDocument();
    expect(screen.getByText('17.5 – 18 in')).toBeInTheDocument();

    await user.click(picker);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/Version 3.*Not activated.*Draft/),
      expect.stringMatching(/Version 2.*Activated.*Active/),
      expect.stringMatching(/Version 1.*Activated.*Retired/),
    ]);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('button', { name: /edit|delete|create|add|new/i })).toBeNull();
  });

  it('summarises findings, highlights only involved cells, and outlines a clicked finding', async () => {
    const { user } = renderApp('/sizes/charts?group=male_top');
    const summary = await screen.findByRole('button', { name: /1 warning, 1 notice/ });
    expect(summary).toHaveTextContent(EXPLANATION);
    expect(summary).toHaveAttribute('aria-expanded', 'false');

    // Involved cells carry an icon + text label; normal cells stay plain.
    const sleeveL = document.getElementById('chart-cell-L-sleeve');
    expect(sleeveL).toHaveAttribute('data-findings', 'MAX_TIE');
    expect(sleeveL).toHaveTextContent('Same max');
    expect(document.getElementById('chart-cell-XL-top_length')).toHaveTextContent('Missing value');
    expect(document.getElementById('chart-cell-M-sleeve')).not.toHaveAttribute('data-findings');
    expect(document.getElementById('chart-cell-XL-chest')).not.toHaveAttribute('data-findings');

    await user.click(summary);
    // Info items are listed (not counted).
    expect(
      screen.getAllByText(
        /Values above this are out of range\. Handling is pending client decision\./,
      ),
    ).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: /Same max.*Sleeve/ }));

    expect(document.getElementById('chart-cell-L-sleeve')).toHaveAttribute('data-focused', 'true');
    expect(document.getElementById('chart-cell-XL-sleeve')).toHaveAttribute('data-focused', 'true');
    expect(document.getElementById('chart-cell-M-sleeve')).not.toHaveAttribute('data-focused');
  });

  it('explains on each cell which max is used for matching', async () => {
    const { user } = renderApp('/sizes/charts?group=male_top');
    await user.hover(await screen.findByText('38 – 40 in'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Max used for matching: 40 in');
  });

  it('shows a clean summary for a chart without warnings or notices', async () => {
    renderApp('/sizes/charts?group=female');
    expect(
      await screen.findByRole('button', { name: /0 warnings, 0 notices/ }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-findings]')).toBeNull();
  });

  it('shows "No chart found for this group" when a group has no version', async () => {
    renderApp('/sizes/charts?group=fila_cap');
    expect(await screen.findByText('No chart found for this group')).toBeInTheDocument();
  });

  it('shows an error panel with a working retry button', { timeout: 15_000 }, async () => {
    let failing = true;
    server.use(
      http.get(`${API}/admin/size-charts/:chartId`, () =>
        failing
          ? HttpResponse.json(
              { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
              { status: 500 },
            )
          : HttpResponse.json({ data: MALE_TOP_CHART }),
      ),
    );
    const { user } = renderApp('/sizes/charts?group=male_top');
    // The query client retries server errors twice before showing the error.
    const alert = await screen.findByRole('alert', {}, { timeout: 10_000 });
    expect(alert).toHaveTextContent('Couldn’t load this size chart');
    failing = false;
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('38 – 40 in')).toBeInTheDocument();
  });

  it('lists measurement profiles; a row expands to measurements, chart groups and products', async () => {
    const { user } = renderApp('/sizes/profiles');
    const row = await screen.findByRole('button', { name: /Male - top \+ trouser set/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await user.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Chest')).toBeInTheDocument();
    expect(screen.getByText('Male trouser')).toBeInTheDocument();
    const product = screen.getByText('Aso Oke Two-Piece');
    // No product page exists in the admin panel yet: plain text, not a link.
    expect(product.closest('a')).toBeNull();
  });

  it('shows sizes with their sort order', async () => {
    renderApp('/sizes');
    const table = await screen.findByRole('table', { name: 'Sizes in sort order' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(['SSmall1', 'MMedium2', 'XS-6XS (6)11']);
    await waitFor(() => expect(document.title).toBe('Sizes · Urban Ibile Admin'));
  });
});
