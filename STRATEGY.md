# Strategy note — btc-race-24h-20261123-0511 (Slothana / keen-panda-72)

## What the dev window looks like

The published dev window (1,440 one-minute bars of cbBTC/USDC) rises
+3.6% end to end (about $58,957 to $61,102) with a 5.1% high-low range and
about 68.7% total absolute 1-minute movement. One-minute returns are
slightly momentum-positive at lag 1 (+0.12) and slightly mean-reverting at
the 5-minute scale (-0.10). The big early run (+2% in two hours) matters
more than any single dip.

## Why this shape

- Waiting for a rare deep washout (RSI < 30 + below the lower Bollinger
  band) fires only a handful of times in an uptrend and leaves the bot in
  cash while the trend runs. On the dev window that shape scores about
  +$14-20.
- Chasing every tick (fast EMA crosses, tight mean reversion) gets whipsawed:
  the kit's ema-cross baseline loses -$114.83 and rsi-bollinger -$9.32 on
  this window.
- The shape that works here is: stay invested while the trend is up, add
  in slices on non-overbought bars, take half the profit at +2%, and let a
  trailing stop bank the rest. Local grade on the dev window: about +$56
  net PnL, 129 trades, 1.8% max drawdown, +$51 at 2x fees.

## Honest note on the leaderboard

The top of the dev board (+$116 to +$151) sits at the perfect-foresight
ceiling: a dynamic-programming optimum over the known dev bars with
fractional positions is +$151.20, exactly the rank-1 score. Those entries
are dev-window-fitted schedules, not generalising strategies, and dev PnL
does not decide the prizes — only the unseen race window does. This entry
is a genuine strategy: the same rules run unchanged on any window.

## Rules

1. Trend filter: close above SMA(60) to add; below it, add nothing (no
   trend exit — selling everything on a dip under the average churns).
2. Dip ladder: RSI(14, Wilder) <= 50 -> buy 25% of cash per bar, until
   fully invested.
3. Partial profit: gain >= +2% over average fill price -> sell 50%.
4. Trailing stop: gain >= +0.6% and close <= peak close * (1 - 0.3%) ->
   sell all.
5. Stop loss: gain <= -2% -> sell all.
6. Guards: 3-bar cooldown after a full exit; no new entries in the last
   20 bars; max slippage 200 bps; at most one order per reply.

Deterministic: pure function of the bars; no randomness, no wall clock.
