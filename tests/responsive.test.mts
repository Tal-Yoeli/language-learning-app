import assert from 'node:assert/strict';
import { test } from 'node:test';

import { columnStyle, resolveLayout } from '../src/ui/breakpoints.ts';

test('phone widths keep the original single-column layout', () => {
  for (const width of [320, 360, 390, 430, 767]) {
    const layout = resolveLayout(width);
    assert.equal(layout.isPhone, true, `${width} should be phone`);
    assert.equal(layout.usesSideNav, false);
    assert.equal(layout.deckColumns, 2);
    // No cap: the phone layout must fill the screen exactly as it does today.
    assert.equal(layout.contentMaxWidth, Number.POSITIVE_INFINITY);
  }
});

test('tablets centre the column but keep the bottom tab bar', () => {
  const layout = resolveLayout(834);
  assert.equal(layout.isTablet, true);
  assert.equal(layout.usesSideNav, false);
  assert.equal(layout.contentMaxWidth, 720);
  assert.equal(layout.deckColumns, 3);
});

test('desktop widths switch to side navigation and a bounded column', () => {
  const layout = resolveLayout(1440);
  assert.equal(layout.isDesktop, true);
  assert.equal(layout.usesSideNav, true);
  assert.equal(layout.contentMaxWidth, 860);
  // Lesson questions get a narrower measure than the dashboard.
  assert.ok(layout.focusMaxWidth < layout.contentMaxWidth);
});

test('a very wide monitor does not stretch the content', () => {
  const wide = resolveLayout(2560);
  const desktop = resolveLayout(1440);
  assert.equal(wide.contentMaxWidth, desktop.contentMaxWidth);
  assert.equal(wide.splitDashboard, true);
});

test('the dashboard only splits once there is genuine room', () => {
  assert.equal(resolveLayout(1024).splitDashboard, false);
  assert.equal(resolveLayout(1199).splitDashboard, false);
  assert.equal(resolveLayout(1200).splitDashboard, true);
});

test('the phone column carries no maxWidth at all', () => {
  // An explicit maxWidth of Infinity would be an invalid RN style value.
  assert.equal(columnStyle(resolveLayout(390).contentMaxWidth).maxWidth, undefined);
  assert.equal(columnStyle(resolveLayout(1440).contentMaxWidth).maxWidth, 860);
  assert.equal(columnStyle(resolveLayout(1440).focusMaxWidth).alignSelf, 'center');
});

test('breakpoint boundaries are exact', () => {
  assert.equal(resolveLayout(767).isPhone, true);
  assert.equal(resolveLayout(768).isTablet, true);
  assert.equal(resolveLayout(1023).isTablet, true);
  assert.equal(resolveLayout(1024).isDesktop, true);
});
