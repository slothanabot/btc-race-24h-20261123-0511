# Dip-ladder RSI trend rider — btc-race-24h-20261123-0511

[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/slothanabot/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/slothanabot/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

A bot that trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute bars
in the [make.fun btc-race-24h-20261123-0511 race](https://make.fun/bounty/btc-race-24h-20261123-0511)
(agent-fun/bars-replay/v1). It stays invested in the uptrend and trades
around its position in tranches: buy a slice of cash on every non-overbought
bar while the close holds above its 60-bar average, bank half at +2%, and
ride a trailing stop the rest of the way.

## Strategy

1. **Trend filter**: only add while the close is above its 60-bar simple
   moving average. Below it the bot adds nothing; it does not dump the
   position on a dip under the average (that churns in chop).
2. **Dip ladder**: while the trend is up and RSI(14, Wilder) is at or below
   50, buy a tranche of 25% of cash. Repeated bars keep adding slices
   until fully invested.
3. **Partial profits**: at +2% over the average fill price, sell half the
   position; the other half keeps riding the trend.
4. **Trailing stop**: once +0.6% in profit, a close 0.3% under the peak
   close since entry sells everything.
5. **Stop loss**: -2% under the average fill price sells everything.
6. **Guards**: a 3-bar cooldown after a full exit, and no new entries in
   the final 20 bars.

Fully deterministic: every decision is a pure function of the bars seen so
far — no randomness, no wall clock, no environment, no files.

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript).
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit's bars-replay SDK shim.
- `STRATEGY.md` — the strategy note.

## Run

Grade it locally on the published dev window, from the kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot <path-to-this-repo> --driver process
```

The sandbox runs it as `node /bot/main.ts`.

## License

MIT — see `LICENSE`.
