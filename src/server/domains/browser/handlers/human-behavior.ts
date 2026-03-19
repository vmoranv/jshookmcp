/**
 * Human behavior simulation handlers.
 *
 * Implements Bezier-curve mouse movement, natural scrolling, and
 * realistic typing with typo simulation.
 */
import type { CodeCollector } from '@server/domains/shared/modules';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';

// ── Bezier helpers ──

interface Point {
  x: number;
  y: number;
}

/** Cubic Bezier: P(t) = (1-t)^3·P0 + 3(1-t)^2·t·P1 + 3(1-t)·t^2·P2 + t^3·P3 */
function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/** Generate control points with lateral offset for natural curve feel. */
function generateControlPoints(from: Point, to: Point): [Point, Point] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Perpendicular offset
  const perpX = -dy;
  const perpY = dx;
  const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
  const offset1 = (Math.random() - 0.5) * 0.4;
  const offset2 = (Math.random() - 0.5) * 0.4;
  return [
    {
      x: from.x + dx * 0.3 + (perpX / len) * Math.abs(dx + dy) * offset1,
      y: from.y + dy * 0.3 + (perpY / len) * Math.abs(dx + dy) * offset1,
    },
    {
      x: from.x + dx * 0.7 + (perpX / len) * Math.abs(dx + dy) * offset2,
      y: from.y + dy * 0.7 + (perpY / len) * Math.abs(dx + dy) * offset2,
    },
  ];
}

/** Easing functions for speed curves. */
function easeT(t: number, curve: string): number {
  switch (curve) {
    case 'linear':
      return t;
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease':
    default:
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTextResponse(payload: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

// ── Exported handlers ──

export async function handleHumanMouse(
  args: Record<string, unknown>,
  collector: CodeCollector
): Promise<unknown> {
  const page = await collector.getActivePage();
  if (!page) throw new Error('No active page. Use browser_launch or browser_attach first.');

  let toX = argNumber(args, 'toX');
  let toY = argNumber(args, 'toY');

  // Resolve selector to coordinates if provided
  const selector = argString(args, 'selector');
  if (selector) {
    const box = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, selector);
    if (!box) throw new Error(`Selector not found: ${selector}`);
    toX = box.x;
    toY = box.y;
  }

  if (toX === undefined || toY === undefined) {
    throw new Error('Either selector or toX/toY coordinates are required');
  }

  const fromX = argNumber(args, 'fromX', 0);
  const fromY = argNumber(args, 'fromY', 0);
  // Clamp step count to avoid divide-by-zero and excessive CPU usage.
  const steps = Math.max(1, Math.min(argNumber(args, 'steps', 24), 500));
  const durationMs = Math.max(10, Math.min(argNumber(args, 'durationMs', 600), 30000));
  const jitterPx = Math.max(0, Math.min(argNumber(args, 'jitterPx', 1.5), 20));
  const curve = argString(args, 'curve', 'ease');
  const shouldClick = argBool(args, 'click', false);

  const from: Point = { x: fromX, y: fromY };
  const to: Point = { x: toX, y: toY };
  const [cp1, cp2] = generateControlPoints(from, to);

  const stepDelay = durationMs / steps;

  for (let i = 0; i <= steps; i++) {
    const rawT = i / steps;
    const t = easeT(rawT, curve);
    const pt = cubicBezier(from, cp1, cp2, to, t);

    // Add jitter (except for first and last points)
    if (i > 0 && i < steps) {
      pt.x += (Math.random() - 0.5) * 2 * jitterPx;
      pt.y += (Math.random() - 0.5) * 2 * jitterPx;
    }

    // Clamp to viewport
    pt.x = Math.max(0, pt.x);
    pt.y = Math.max(0, pt.y);

    await page.mouse.move(pt.x, pt.y);
    await sleep(stepDelay * (0.8 + Math.random() * 0.4)); // ±20% timing jitter
  }

  if (shouldClick) {
    await page.mouse.click(toX, toY);
  }

  return toTextResponse({
    success: true,
    from: { x: fromX, y: fromY },
    to: { x: toX, y: toY },
    steps,
    durationMs,
    clicked: shouldClick,
  });
}

export async function handleHumanScroll(
  args: Record<string, unknown>,
  collector: CodeCollector
): Promise<unknown> {
  const page = await collector.getActivePage();
  if (!page) throw new Error('No active page.');

  const distance = Math.max(1, Math.min(argNumber(args, 'distance', 500), 10000));
  const direction = argString(args, 'direction', 'down');
  const segments = Math.max(1, Math.min(argNumber(args, 'segments', 8), 200));
  const pauseMs = Math.max(0, Math.min(argNumber(args, 'pauseMs', 80), 5000));
  const jitter = Math.max(0, Math.min(argNumber(args, 'jitter', 0.3), 1));
  const selector = argString(args, 'selector');

  const isVertical = direction === 'up' || direction === 'down';
  const sign = direction === 'down' || direction === 'right' ? 1 : -1;

  let scrolled = 0;
  for (let i = 0; i < segments; i++) {
    // Decelerate towards end
    const progress = i / segments;
    const decel = 1 - progress * 0.4; // slow down by 40% at the end
    const baseSegment = (distance / segments) * decel;
    const segmentDist = baseSegment * (1 + (Math.random() - 0.5) * jitter * 2);
    const actualDist = Math.min(segmentDist, distance - scrolled);

    if (actualDist <= 0) break;

    const deltaX = isVertical ? 0 : actualDist * sign;
    const deltaY = isVertical ? actualDist * sign : 0;

    if (selector) {
      await page.evaluate(
        (sel: string, dx: number, dy: number) => {
          const el = document.querySelector(sel);
          if (el) el.scrollBy({ left: dx, top: dy, behavior: 'auto' });
        },
        selector,
        deltaX,
        deltaY
      );
    } else {
      await page.evaluate(
        (dx: number, dy: number) => window.scrollBy({ left: dx, top: dy, behavior: 'auto' }),
        deltaX,
        deltaY
      );
    }

    scrolled += actualDist;

    // Randomized pause between segments
    const actualPause = pauseMs * (0.5 + Math.random());
    await sleep(actualPause);
  }

  return toTextResponse({
    success: true,
    direction,
    requestedDistance: distance,
    actualScrolled: Math.round(scrolled),
    segments,
  });
}

export async function handleHumanTyping(
  args: Record<string, unknown>,
  collector: CodeCollector
): Promise<unknown> {
  const page = await collector.getActivePage();
  if (!page) throw new Error('No active page.');

  const selector = argString(args, 'selector', '');
  const text = argString(args, 'text', '');
  const wpm = Math.max(10, Math.min(argNumber(args, 'wpm', 90), 300));
  const errorRate = Math.max(0, Math.min(argNumber(args, 'errorRate', 0.02), 0.3));
  const correctDelayMs = Math.max(50, Math.min(argNumber(args, 'correctDelayMs', 200), 2000));
  const clearFirst = argBool(args, 'clearFirst', false);

  if (!selector || !text) {
    throw new Error('selector and text are required');
  }

  // Average delay per character from WPM (assuming 5 chars per word)
  const avgDelayMs = 60_000 / (wpm * 5);

  // Focus and optionally clear
  await page.click(selector);
  if (clearFirst) {
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement;
      if (el) el.value = '';
    }, selector);
  }

  let typoCount = 0;

  for (const char of text) {
    // Simulate typo
    if (Math.random() < errorRate && char !== ' ') {
      // Type a wrong character
      const wrongChar = String.fromCharCode(char.charCodeAt(0) + (Math.random() > 0.5 ? 1 : -1));
      await page.keyboard.type(wrongChar, { delay: 0 });
      await sleep(correctDelayMs * (0.5 + Math.random()));
      // Correct it
      await page.keyboard.press('Backspace');
      await sleep(50 + Math.random() * 50);
      typoCount++;
    }

    // Type the correct character
    await page.keyboard.type(char, { delay: 0 });

    // Variable delay
    let delay = avgDelayMs * (0.5 + Math.random());
    // Longer pause after spaces/punctuation
    if (char === ' ' || '.,:;!?'.includes(char)) {
      delay *= 1.5 + Math.random() * 0.5;
    }
    await sleep(delay);
  }

  return toTextResponse({
    success: true,
    selector,
    length: text.length,
    wpm,
    typosSimulated: typoCount,
    errorRate,
  });
}
