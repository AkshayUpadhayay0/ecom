// Stage 4: Find My Size (Blueprint), the height and weight concept, sign in / register / account.
import AxeBuilder from '../../../../apps/web/node_modules/@axe-core/playwright/dist/index.mjs';
import { expect, test } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';

const FIT = '/index.html#/fit/sample-outfit-03'; // male profile: sizes M L XL XXL, stock M 7, L 3, XL 2 (low), XXL 1 (low)

async function signedIn(page, hash = FIT) {
  await page.goto('/index.html#/signin');
  await page.locator('#email').fill('sample@example.test');
  await page.locator('#password').fill('anything');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/#\/account$/);
  await page.goto(`/index.html${hash.replace('/index.html', '')}`);
}

async function measure(page, values) {
  for (const [id, value] of Object.entries(values)) await page.locator(`#m-${id}`).fill(value);
}

test.describe('Find My Size', () => {
  test('asks you to sign in first, and returns you to the flow afterwards', async ({ page }) => {
    await page.goto(FIT);
    await expect(page.getByText('Sign in to find your size.')).toBeVisible();
    await page.getByRole('link', { name: 'Sign in to continue' }).click();
    await expect(page).toHaveURL(/#\/signin\?next=%2Ffit%2Fsample-outfit-03/);
    await page.locator('#email').fill('sample@example.test');
    await page.locator('#password').fill('anything');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/#\/fit\/sample-outfit-03$/);
    await expect(page.getByRole('heading', { name: 'Your measurements' })).toBeVisible();
  });

  test('walks measurements, fit preference and recommendation, then back to the outfit with the size', async ({ page }) => {
    await signedIn(page);
    await expect(page.getByRole('list', { name: 'Steps' }).locator('[aria-current=step]')).toContainText('1. Measurements');
    await expect(page.locator('.input-unit span')).toHaveCount(4); // inches on every field
    await measure(page, { chest: '41', shoulder: '17', sleeve: '24', length: '28' }); // chest needs M(42)? 41<=42 -> M; shoulder 17 -> M
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Fit preference' })).toBeFocused();
    const prefs = page.getByRole('group', { name: 'Fit preference' });
    await expect(prefs.getByRole('radio')).toHaveCount(3);
    await expect(prefs.getByRole('radio', { name: 'Standard' })).toBeChecked();
    await prefs.getByText('Oversized').click();
    await page.getByRole('button', { name: 'See my size' }).click();
    await expect(page.getByRole('heading', { name: 'Your recommended size' })).toBeFocused();
    await expect(page.getByTestId('recommended-size')).toContainText('M');
    await expect(page.getByTestId('stock')).toHaveText('In stock');
    await expect(page.getByText('Fit preference saved with your measurements:')).toContainText('Oversized');
    await page.getByRole('button', { name: 'Use size M' }).click();
    await expect(page).toHaveURL(/#\/product\/sample-outfit-03$/);
    await expect(page.getByTestId('your-size')).toContainText('Size M');
    await expect(page.getByTestId('your-size')).toContainText('Recommended from your measurements');
    await expect(page.locator('#add')).toBeEnabled();
    await page.locator('#add').click();
    await expect(page.getByRole('dialog', { name: 'Your cart' })).toContainText('Recommended for your measurements');
  });

  test('the recommendation is the largest size any measurement needs, with a per-measurement breakdown', async ({ page }) => {
    await signedIn(page);
    await measure(page, { chest: '41', shoulder: '18.5', sleeve: '24', length: '28' }); // shoulder 18.5 needs XL
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'See my size' }).click();
    await expect(page.getByTestId('recommended-size')).toContainText('XL');
    const table = page.getByRole('table');
    await expect(table.getByRole('row', { name: /Chest.*41 in.*M/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Shoulder.*18.5 in.*XL.*decides/ })).toBeVisible();
    await expect(page.getByTestId('stock')).toHaveText('Low stock');
  });

  test('the fit preference never changes the recommended size', async ({ page }) => {
    const sizes = [];
    for (const pref of ['Tailored', 'Standard', 'Oversized']) {
      await signedIn(page);
      await measure(page, { chest: '44', shoulder: '17', sleeve: '24', length: '28' });
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('group', { name: 'Fit preference' }).getByText(pref).click();
      await page.getByRole('button', { name: 'See my size' }).click();
      sizes.push((await page.getByTestId('recommended-size').textContent()).trim());
    }
    expect(new Set(sizes).size).toBe(1);
  });

  test('validates in inches with plain messages and moves focus to the first problem', async ({ page }) => {
    await signedIn(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter a measurement.')).toHaveCount(4);
    await expect(page.locator('#m-chest')).toBeFocused();
    await expect(page.locator('#m-chest')).toHaveAttribute('aria-invalid', 'true');
    await measure(page, { chest: 'abc', shoulder: '17.55', sleeve: '1', length: '99' });
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Use numbers only, for example 42 or 42.5.')).toBeVisible();
    await expect(page.getByText('Use at most one decimal place.')).toBeVisible();
    await expect(page.getByText(/looks too small\. The smallest we accept is 15 in\./)).toBeVisible();
    await expect(page.getByText(/looks too large\. The largest we accept is 45 in\./)).toBeVisible();
  });

  test('the sample-measurements shortcut fills the form', async ({ page }) => {
    await signedIn(page);
    await page.getByRole('button', { name: 'Fill in sample measurements' }).click();
    await expect(page.locator('#m-chest')).toHaveValue('42');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Fit preference' })).toBeVisible();
  });

  test('a measurement above the chart gets the neutral message and nothing else is invented', async ({ page }) => {
    await signedIn(page, '/index.html#/fit/sample-outfit-03?demo=range');
    await expect(page.getByRole('heading', { name: 'We could not match this measurement to our size chart.' })).toBeVisible();
    await expect(page.getByText(/is above the largest size on our chart/).first()).toBeVisible();
    await expect(page.getByText('You can contact us for help: [support contact: supplied by the client]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Use size/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Change measurements' }).click();
    await expect(page.getByRole('heading', { name: 'Your measurements' })).toBeVisible();
  });

  test('a size the outfit is not made in must be replaced by one of its sizes', async ({ page }) => {
    await signedIn(page, '/index.html#/fit/sample-outfit-03?demo=small'); // needs S, but this blazer starts at M
    await expect(page.getByText('This outfit is not made in size S. Please choose one of the sizes below.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use size S' })).toBeDisabled();
    await page.getByRole('radio', { name: /^Size M/ }).click();
    await page.getByRole('button', { name: 'Use size M instead' }).click();
    await expect(page.getByTestId('your-size')).toContainText('Size M');
    await expect(page.getByTestId('your-size')).toContainText('Your choice (we recommended S)');
  });

  test('choosing another size uses neutral wording and shows stock; out-of-stock sizes cannot be chosen', async ({ page }) => {
    await signedIn(page);
    await page.getByRole('button', { name: 'Fill in sample measurements' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'See my size' }).click();
    await expect(page.getByRole('heading', { name: 'Prefer a different size?' })).toBeVisible();
    await expect(page.getByText('You can choose any size this outfit is made in. We save your choice together with your measurements.')).toBeVisible();
    const other = page.getByRole('radiogroup', { name: 'Choose a size' });
    await expect(other.getByRole('radio')).toHaveCount(4);
    await expect(other.getByRole('radio', { name: /^Size XL/ })).toContainText('Low stock');
    await other.getByRole('radio', { name: /^Size L/ }).click();
    await page.getByRole('button', { name: 'Use size L instead' }).click();
    await expect(page.getByTestId('your-size')).toContainText('Size L');
    await expect(page.getByTestId('your-size')).toContainText('Your choice (we recommended M)');
    await page.locator('#add').click();
    await expect(page.getByRole('dialog', { name: 'Your cart' })).toContainText('Your choice');
  });

  test('works with the keyboard only', async ({ page }) => {
    await signedIn(page);
    await page.locator('#m-chest').focus();
    for (const v of ['42', '17', '24', '28']) { await page.keyboard.type(v); await page.keyboard.press('Tab'); }
    await page.getByRole('button', { name: 'Continue' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Fit preference' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'See my size' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('recommended-size')).toBeVisible();
  });

  test('an outfit without Blueprint has no Find My Size', async ({ page }) => {
    await signedIn(page, '/index.html#/fit/sample-outfit-08');
    await expect(page.getByText('This outfit has no Blueprint fit. Choose a size from the list.')).toBeVisible();
  });

  for (const width of [390, 768, 1440]) {
    test(`has no sideways scrolling at ${width}px on every step`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signedIn(page);
      const flat = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await flat()).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'Fill in sample measurements' }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
      expect(await flat()).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'See my size' }).click();
      expect(await flat()).toBeLessThanOrEqual(1);
    });
  }
});

test.describe('height and weight concept', () => {
  test('is clearly marked as a concept, has a disabled Continue, and calculates nothing', async ({ page }) => {
    await page.goto('/index.html#/fit-concept');
    await expect(page.getByRole('note')).toContainText('CONCEPT');
    await expect(page.getByRole('note')).toContainText('Pending client decision: needs brand sizing rules.');
    await expect(page.getByLabel('Height')).toBeEnabled();
    await page.getByLabel('Height').fill('175');
    await page.getByLabel('Weight').fill('70');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.getByText(/no calculation/i)).toBeVisible();
    await expect(page.getByTestId('recommended-size')).toHaveCount(0);
    await page.getByRole('link', { name: /Use body measurements instead/ }).click();
    await expect(page).toHaveURL(/#\/fit\/sample-outfit-03$/);
  });
});

test.describe('sign in, register and account', () => {
  test('sign in validates, then signs in; the header and menu change; sign out undoes it', async ({ page }) => {
    await page.goto('/index.html#/signin');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.locator('#email')).toBeFocused();
    await page.locator('#email').fill('sample@example.test');
    await page.locator('#password').fill('x');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/#\/account$/);
    await expect(page.getByRole('link', { name: 'Account' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu.getByRole('link', { name: 'My orders' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('register shows the password rule, requires the terms, and nothing typed is stored', async ({ page }) => {
    await page.goto('/index.html#/register');
    await expect(page.getByText('Use at least 10 characters. Very common passwords are not accepted.')).toBeVisible();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('This field is required.')).toBeVisible();
    await expect(page.getByText('You must accept to continue.')).toBeVisible();
    await page.locator('#name').fill('Secret Person');
    await page.locator('#email').fill('secret.person@example.test');
    await page.locator('#password').fill('a-long-password-1');
    await page.getByLabel('I accept the terms and conditions.').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/#\/account$/);
    const stored = await page.evaluate(() => JSON.stringify([sessionStorage, localStorage]));
    expect(stored).not.toContain('secret.person');
    expect(stored).not.toContain('Secret Person');
    expect(stored).not.toContain('a-long-password');
    await expect(page.getByText('[Sample customer]')).toBeVisible();
  });

  test('the next address is only followed inside the prototype', async ({ page }) => {
    await page.goto('/index.html#/signin?next=' + encodeURIComponent('//evil.example/x'));
    await page.locator('#email').fill('sample@example.test');
    await page.locator('#password').fill('x');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/#\/account$/);
  });
});

test.describe('accessibility', () => {
  for (const [name, setup] of [
    ['sign-in gate', async (page) => { await page.goto(FIT); }],
    ['step 1, measurements', async (page) => { await signedIn(page); }],
    ['step 1 with errors', async (page) => { await signedIn(page); await page.getByRole('button', { name: 'Continue' }).click(); }],
    ['step 2, fit preference', async (page) => { await signedIn(page); await page.getByRole('button', { name: 'Fill in sample measurements' }).click(); await page.getByRole('button', { name: 'Continue' }).click(); }],
    ['step 3, recommendation', async (page) => { await signedIn(page); await page.getByRole('button', { name: 'Fill in sample measurements' }).click(); await page.getByRole('button', { name: 'Continue' }).click(); await page.getByRole('button', { name: 'See my size' }).click(); }],
    ['step 3, out of range', async (page) => { await signedIn(page, '/index.html#/fit/sample-outfit-03?demo=range'); }],
    ['step 3, size not offered', async (page) => { await signedIn(page, '/index.html#/fit/sample-outfit-03?demo=small'); }],
    ['concept screen', async (page) => { await page.goto('/index.html#/fit-concept'); }],
    ['sign in', async (page) => { await page.goto('/index.html#/signin'); }],
    ['sign in with errors', async (page) => { await page.goto('/index.html#/signin'); await page.getByRole('button', { name: 'Sign in' }).click(); }],
    ['register', async (page) => { await page.goto('/index.html#/register'); }],
    ['register with errors', async (page) => { await page.goto('/index.html#/register'); await page.getByRole('button', { name: 'Create account' }).click(); }],
    ['account', async (page) => { await signedIn(page, '/index.html#/account'); }],
    ['product with a saved size', async (page) => { await signedIn(page); await page.getByRole('button', { name: 'Fill in sample measurements' }).click(); await page.getByRole('button', { name: 'Continue' }).click(); await page.getByRole('button', { name: 'See my size' }).click(); await page.getByRole('button', { name: 'Use size M' }).click(); }],
  ]) {
    test(`axe: ${name} has no WCAG A/AA violations`, async ({ page }) => {
      await setup(page);
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});
