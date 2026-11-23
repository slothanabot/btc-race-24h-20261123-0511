// Dip-ladder RSI trend rider for cbBTC/USDC (agent-fun/bars-replay/v1).
//
// Idea: on this pool BTC trends up slowly with noisy 1-minute bars. A bot
// that waits for a rare deep washout sits in cash while the trend runs; a
// bot that chases every tick gets whipsawed. This bot stays invested in the
// uptrend and trades around its position in tranches:
//
//   1. TREND FILTER: only buy while the close is above its 60-bar simple
//      moving average. Below it, the bot adds nothing (it does not dump the
//      position on every dip under the average: that churns in chop).
//   2. DIP LADDER: while the trend is up and RSI(14, Wilder) is at or below
//      50 (not overbought), buy a tranche of 25% of cash. Repeated bars keep
//      adding tranches until fully invested, so a pullback is bought in
//      slices instead of all at once at the first sign of weakness.
//   3. PARTIAL PROFITS: when the position is +2% over its average fill
//      price, sell half. The trend can keep running with the other half.
//   4. TRAILING STOP: once +0.6% in profit, a close 0.3% under the peak
//      close since entry sells everything, banking the run instead of
//      giving it back.
//   5. STOP LOSS: -2% under the average fill price sells everything.
//   6. GUARDS: a 3-bar cooldown after a full exit, and no new entries in
//      the final 20 bars (a position needs room to play out before the
//      window flattens everything).
//
// Fully deterministic: every decision is a pure function of the bars seen
// so far. No randomness, no wall clock, no environment, no files.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy parameters (tuned on the published dev window only) ---
const RSI_PERIOD = 14; // RSI length (Wilder smoothing)
const RSI_BUY_MAX = 50; // buy a tranche while RSI is at or below this
const TREND_BARS = 60; // trend filter: SMA length
const TRANCHE_FRAC_NUM = 1n; // buy 25% of cash per tranche
const TRANCHE_FRAC_DEN = 4n;
const TAKE_PROFIT = 0.02; // +2% over average fill price -> sell half
const TAKE_FRAC_DEN = 2n; // sell half the position on take-profit
const STOP_LOSS = 0.02; // -2% under average fill price -> sell all
const TRAIL_ARM = 0.006; // trailing stop activates at +0.6%
const TRAIL_GAP = 0.003; // trail 0.3% behind the peak close
const COOLDOWN_BARS = 3; // bars to wait after a full exit
const NO_ENTRY_TAIL = 20; // no new entries in the final 20 bars
const WINDOW_BARS = 1440; // bars in the window
const MAX_SLIPPAGE_BPS = 200; // 2% from the latest close
const MIN_NOTIONAL = 1_000_000n; // 1 USDC, in micro-USDC

// RSI(14) with Wilder smoothing, computed from scratch each bar so the
// value is a pure function of the closes seen so far.
function rsiWilder(closes: number[]): number | null {
  if (closes.length < RSI_PERIOD + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let k = 1; k <= RSI_PERIOD; k++) {
    const d = closes[k] - closes[k - 1];
    if (d > 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= RSI_PERIOD;
  avgLoss /= RSI_PERIOD;
  for (let k = RSI_PERIOD + 1; k < closes.length; k++) {
    const d = closes[k] - closes[k - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (RSI_PERIOD - 1) + g) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + l) / RSI_PERIOD;
  }
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  let sum = 0;
  for (let k = closes.length - n; k < closes.length; k++) sum += closes[k];
  return sum / n;
}

async function main(): Promise<void> {
  const closes: number[] = [];
  let avgCost: number | null = null; // average fill price of the position (raw units)
  let peakPx = 0; // highest close since the position opened
  let cooldownUntil = -1; // seq before which no new entry

  await runBars({
    onBatch(state: BarsState, batch: Batch) {
      const bar = batch.bars.find((b) => b.symbol === SYMBOL);
      // Fold fills first: they tell us our real entry prices.
      for (const fill of batch.fills) {
        if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
        const qty = BigInt(fill.qty);
        const price = Number(fill.price);
        if (fill.side === 'buy') {
          const held = state.positions.get(SYMBOL)?.qty ?? 0n;
          const before = held - qty;
          if (before > 0n && avgCost !== null) {
            avgCost =
              (avgCost * Number(before) + price * Number(qty)) /
              Number(held);
          } else {
            avgCost = price;
          }
          peakPx = price;
        } else if (fill.side === 'sell') {
          const held = state.positions.get(SYMBOL)?.qty ?? 0n;
          if (held === 0n) {
            avgCost = null;
            peakPx = 0;
          }
        }
      }
      if (bar === undefined) return [];

      const close = Number(bar.c);
      closes.push(close);
      const n = closes.length;
      if (n < 2) return [];

      const pos = state.positions.get(SYMBOL);
      const qty = pos === undefined ? 0n : pos.qty;

      // --- manage an open position ---
      if (qty > 0n && avgCost !== null) {
        if (close > peakPx) peakPx = close;
        const gain = close / avgCost - 1;
        // Full exits first: stop loss and trailing stop. (No trend exit:
        // selling the whole position on every dip under the average churns
        // in chop; the trend filter gates entries only.)
        let fullExit = false;
        if (gain <= -STOP_LOSS) fullExit = true;
        else if (gain >= TRAIL_ARM && close <= peakPx * (1 - TRAIL_GAP)) fullExit = true;
        if (fullExit) {
          cooldownUntil = batch.seq + 1 + COOLDOWN_BARS;
          return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        // Partial profit: sell half at +2% over average cost.
        if (gain >= TAKE_PROFIT) {
          const half = qty / TAKE_FRAC_DEN;
          if (half > 0n) {
            return [{ side: 'sell', symbol: SYMBOL, qty: half, max_slippage_bps: MAX_SLIPPAGE_BPS }];
          }
        }
      }

      // --- entries: a tranche while the trend is up and RSI is not overbought ---
      if (batch.seq >= WINDOW_BARS - NO_ENTRY_TAIL) return [];
      if (batch.seq < cooldownUntil) return [];
      const trend = sma(closes, TREND_BARS);
      if (trend === null || close <= trend) return [];
      const rsi = rsiWilder(closes);
      if (rsi === null || rsi > RSI_BUY_MAX) return [];
      let notional = (state.cash * TRANCHE_FRAC_NUM) / TRANCHE_FRAC_DEN;
      const room = state.weightRoom(SYMBOL);
      if (notional > room) notional = room;
      if (notional > state.cash) notional = state.cash;
      if (notional < MIN_NOTIONAL) return [];
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    },
  });
}

await main();
