/* My Wallet: Trading practice. PAPER TRADING ONLY, no real money, no broker connection, no real orders.
   Loaded only when the Trading page is opened. Nothing here changes wallet balances, SIP or any wallet entry.
   Prices are typed in by you; no live market data is connected, and nothing here invents a price. */
(function (root) {
  'use strict';
  var DISCLAIMER = 'PAPER TRADING – NO REAL MONEY INVOLVED.';

  /* ================= engine (pure functions, tested in tests/run.js) ================= */
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : NaN; }
  function r2(v) { return Math.round(v * 100) / 100; }
  var DEF = { capital: 100000, riskPct: 1, maxDaily: 2000, maxWeekly: 5000, maxTradesDay: 3, brokPct: 0.1, fixedFee: 20 };
  function cfgOf(c) {
    var o = {}, k;
    for (k in DEF) { o[k] = (c && typeof c[k] === 'number' && isFinite(c[k]) && c[k] >= 0) ? c[k] : DEF[k]; }
    if (!(o.capital > 0)) o.capital = DEF.capital;
    if (o.riskPct > 5) o.riskPct = 5;
    if (!(o.riskPct > 0)) o.riskPct = DEF.riskPct;
    o.ack = !!(c && c.ack === true);
    return o;
  }
  function fee(value, cfg) { return r2(value * cfg.brokPct / 100 + cfg.fixedFee); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function okSym(s) { return typeof s === 'string' && /^[A-Z0-9&.\-]{1,20}$/.test(s); }
  function okTrade(t) {
    return !!t && typeof t.id === 'string' && okSym(t.sym) && Number.isInteger(t.qty) && t.qty > 0 && t.entry > 0 && t.stop > 0 && t.stop < t.entry &&
      isDate(t.date) && (t.status === 'open' || (t.status === 'closed' && t.exit > 0 && isDate(t.exitDate)));
  }
  function pnl(t, cfg) {   /* net of estimated costs; for open trades it uses the last price you typed, if any */
    var fin = t.feesIn != null ? t.feesIn : fee(t.entry * t.qty, cfg);
    if (t.status === 'closed') { var fout = t.feesOut != null ? t.feesOut : fee(t.exit * t.qty, cfg); return r2((t.exit - t.entry) * t.qty - fin - fout); }
    return t.last > 0 ? r2((t.last - t.entry) * t.qty - fin) : 0;
  }
  function account(trades, cfg) {
    var cash = cfg.capital, open = 0, realized = 0, unreal = 0;
    trades.forEach(function (t) {
      var fin = t.feesIn != null ? t.feesIn : fee(t.entry * t.qty, cfg);
      if (t.status === 'closed') { var p = pnl(t, cfg); cash += p; realized += p; }
      else { cash -= t.entry * t.qty + fin; open += (t.last > 0 ? t.last : t.entry) * t.qty; unreal += pnl(t, cfg); }
    });
    return { cash: r2(cash), openValue: r2(open), realized: r2(realized), unrealized: r2(unreal), equity: r2(cash + open) };
  }
  function closedSorted(trades) { return trades.filter(function (t) { return t.status === 'closed'; }).sort(function (a, b) { return a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : (a.ts || 0) - (b.ts || 0); }); }
  function stats(trades, cfg) {
    var cl = closedSorted(trades), w = [], l = [], cum = 0, peak = 0, dd = 0, by = {};
    cl.forEach(function (t) {
      var p = pnl(t, cfg); if (p > 0) w.push(p); else l.push(p);
      cum += p; if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum;
      var k = t.strat || 'Other'; by[k] = by[k] || { n: 0, wins: 0, net: 0 }; by[k].n++; by[k].net = r2(by[k].net + p); if (p > 0) by[k].wins++;
    });
    var sum = function (a) { return a.reduce(function (s, x) { return s + x; }, 0); };
    var avgW = w.length ? r2(sum(w) / w.length) : 0, avgL = l.length ? r2(sum(l) / l.length) : 0;
    return { total: trades.length, closed: cl.length, open: trades.length - cl.length, wins: w.length, losses: l.length,
      winRate: cl.length ? Math.round(w.length / cl.length * 1000) / 10 : 0, avgWin: avgW, avgLoss: avgL,
      rr: avgL < 0 ? Math.round(avgW / -avgL * 100) / 100 : null, net: r2(cum), maxDrawdown: r2(dd), byStrategy: by };
  }
  function rr(entry, stop, target) { return (entry > stop && target > entry) ? Math.round((target - entry) / (entry - stop) * 100) / 100 : null; }
  function sizePosition(o) {  /* quantity so that hitting the stop loses about riskPct of capital, never more than the cash available */
    var per = o.entry - o.stop;
    if (!(o.entry > 0 && o.stop > 0 && per > 0 && o.capital > 0)) return { qty: 0, why: 'Enter an entry price and a stop-loss below it.' };
    var byRisk = Math.floor(o.capital * o.riskPct / 100 / per);
    var byCash = Math.floor(Math.max(o.cash, 0) / (o.entry * (1 + o.brokPct / 100)));
    var q = Math.max(0, Math.min(byRisk, byCash));
    return { qty: q, riskAmount: r2(q * per), byRisk: byRisk, byCash: byCash, limitedByCash: byCash < byRisk };
  }
  function limits(trades, cfg, today) {
    var cl = trades.filter(function (t) { return t.status === 'closed'; }), wk0 = addDays(today, -6), dayNet = 0, wkNet = 0;
    cl.forEach(function (t) { var p = pnl(t, cfg); if (t.exitDate === today) dayNet += p; if (t.exitDate >= wk0 && t.exitDate <= today) wkNet += p; });
    var tradesToday = trades.filter(function (t) { return t.date === today; }).length;
    var last = closedSorted(trades).slice(-3), streak = 0;
    for (var i = last.length - 1; i >= 0; i--) { if (pnl(last[i], cfg) < 0) streak++; else break; }
    return { dayLoss: dayNet < 0 ? r2(-dayNet) : 0, weekLoss: wkNet < 0 ? r2(-wkNet) : 0, tradesToday: tradesToday, lossStreak: streak };
  }
  /* returns {errors, warnings}. Errors stop the trade. Warnings are shown and you decide. */
  function checkBuy(t, trades, cfg, today) {
    var e = [], w = [], acc = account(trades, cfg), lim = limits(trades, cfg, today);
    if (!okSym(t.sym)) e.push('Enter the share code in capital letters, for example RELIANCE.');
    if (!(Number.isInteger(t.qty) && t.qty > 0)) e.push('Quantity must be a whole number above zero.');
    if (!(t.entry > 0)) e.push('Enter the entry price.');
    if (!(t.stop > 0)) e.push('A stop-loss is required. It is the price where you accept you were wrong.');
    else if (t.entry > 0 && t.stop >= t.entry) e.push('The stop-loss must be below the entry price. Practice trades here are buys only.');
    if (t.target != null && t.target !== '' && !(t.target > t.entry)) e.push('The target must be above the entry price.');
    if (!isDate(t.date)) e.push('Pick a valid date.');
    if (e.length) return { errors: e, warnings: w };
    var cost = t.entry * t.qty + fee(t.entry * t.qty, cfg);
    if (cost > acc.cash + 0.0001) e.push('Not enough practice cash. You need ' + r2(cost) + ' and have ' + acc.cash + '. Borrowing is not allowed.');
    var risk = (t.entry - t.stop) * t.qty, maxRisk = cfg.capital * cfg.riskPct / 100;
    if (risk > maxRisk + 0.0001) w.push('Your risk on this trade is ' + r2(risk) + ', above your limit of ' + r2(maxRisk) + ' (' + cfg.riskPct + '% of capital).');
    if ((t.entry - t.stop) / t.entry > 0.1) w.push('The stop-loss is more than 10% below the entry. That is a wide stop.');
    var ratio = t.target > 0 ? rr(t.entry, t.stop, t.target) : null;
    if (t.target > 0 && ratio !== null && ratio < 1.5) w.push('Reward to risk is only ' + ratio + ' to 1. Many traders look for at least 1.5 to 1.');
    if (!(t.target > 0)) w.push('No target set. Decide where you will take profit before you enter.');
    if (t.entry * t.qty > cfg.capital * 0.25) w.push('This position is more than 25% of your capital in one share.');
    var exposure = acc.openValue + t.entry * t.qty;
    if (exposure > cfg.capital * 0.6) w.push('Open positions would be more than 60% of your capital.');
    if (lim.tradesToday >= cfg.maxTradesDay) w.push('You already made ' + lim.tradesToday + ' trade(s) today. Your limit is ' + cfg.maxTradesDay + '.');
    if (lim.dayLoss >= cfg.maxDaily && cfg.maxDaily > 0) w.push('You have reached your daily loss limit (' + cfg.maxDaily + '). Stopping for today protects you.');
    if (lim.weekLoss >= cfg.maxWeekly && cfg.maxWeekly > 0) w.push('You have reached your weekly loss limit (' + cfg.maxWeekly + ').');
    if (lim.lossStreak >= 2) w.push('Your last ' + lim.lossStreak + ' closed trades were losses. A pause and a review can help before the next trade.');
    return { errors: e, warnings: w };
  }
  function priceHit(t) { if (t.status !== 'open' || !(t.last > 0)) return null; if (t.last <= t.stop) return 'stop'; if (t.target > 0 && t.last >= t.target) return 'target'; return null; }
  function weekly(trades, cfg, today) {
    var a = addDays(today, -6), cl = trades.filter(function (t) { return t.status === 'closed' && t.exitDate >= a && t.exitDate <= today; });
    var s = stats(cl, cfg), lines = [];
    if (!cl.length) return { count: 0, lines: ['No closed practice trades in the last 7 days.'], net: 0, from: a };
    lines.push(cl.length + ' trade(s) closed: ' + s.wins + ' win(s), ' + s.losses + ' loss(es), net ' + s.net + '.');
    if (s.losses && s.wins && s.avgWin < -s.avgLoss) lines.push('Your average loss is bigger than your average win. Cutting losses sooner or setting wider targets may help.');
    if (s.winRate < 40 && cl.length >= 5) lines.push('Win rate is under 40%. That can still work if wins are much bigger than losses, so check your reward to risk.');
    var noWhy = cl.filter(function (t) { return !t.why; }).length;
    if (noWhy) lines.push(noWhy + ' trade(s) have no reason written. Writing the reason before you enter makes the review honest.');
    var noLesson = cl.filter(function (t) { return !t.lesson; }).length;
    if (noLesson) lines.push(noLesson + ' closed trade(s) have no lesson noted yet.');
    if (cl.length > cfg.maxTradesDay * 5) lines.push('That is a lot of trades for one week. More trades usually means more costs.');
    return { count: cl.length, lines: lines, net: s.net, from: a };
  }
  /* calm, educational explanation of a setup. It never says buy or sell and never predicts. */
  function explain(o, cfg) {
    var L = [], R = [];
    if (!(o.entry > 0 && o.stop > 0 && o.stop < o.entry)) return { title: 'Missing information', lines: ['Enter an entry price and a stop-loss below it, then I can explain the setup.'], risks: [] };
    var per = o.entry - o.stop, pct = per / o.entry * 100, ratio = o.target > 0 ? rr(o.entry, o.stop, o.target) : null;
    L.push('If price falls to your stop-loss, you lose ' + r2(per) + ' per share (' + (Math.round(pct * 10) / 10) + '% of the entry price).');
    if (o.qty > 0) {
      var risk = per * o.qty, lim = cfg.capital * cfg.riskPct / 100;
      L.push('With ' + o.qty + ' share(s) that is a risk of about ' + r2(risk) + ', which is ' + (Math.round(risk / cfg.capital * 1000) / 10) + '% of your capital. Your limit is ' + cfg.riskPct + '%.');
      if (risk > lim) R.push('The position is larger than your own risk limit.');
    }
    if (ratio !== null) { L.push('Reward to risk is ' + ratio + ' to 1.'); if (ratio < 1.5) R.push('Reward to risk is on the low side.'); else L.push('At that ratio you can be wrong more often than right and still do well, but only if you follow the plan.'); }
    else L.push('There is no target yet. Deciding where you will take profit, before entering, keeps emotions out.');
    if (pct > 10) R.push('The stop-loss is far from the entry, so one loss can be large.');
    if (pct < 0.5) R.push('The stop-loss is very tight. Normal small price moves may trigger it.');
    R.push('Prices you type here are not a prediction. Confirmation such as trend direction, volume or a nearby support or resistance level is something to check yourself.');
    R.push('If you are unsure, waiting is a valid choice. No trade is also a decision.');
    return { title: 'Setup explanation (education only, not advice)', lines: L, risks: R };
  }

  /* ================= academy ================= */
  var LESSONS = [
    { id: 'l1', t: 'What is the stock market?', k: 'stock market shares company', b: ['A stock is a small piece of ownership in a company. The stock market is where people buy and sell those pieces.', 'Prices move because buyers and sellers disagree about what a company is worth. More buyers than sellers pushes the price up; more sellers pushes it down.'], x: 'If many people want to buy a company\'s shares after good news, the price tends to rise.', q: ['What mainly moves a share price?', ['Demand and supply from buyers and sellers', 'The company logo', 'The day of the week only'], 0, 'Price is set by buyers and sellers trading with each other.'] },
    { id: 'l2', t: 'What is investing?', k: 'investing long term dividend', b: ['Investing means putting money into assets you expect to grow over many years, such as good businesses or index funds.', 'Investors care about the business, not the daily price. Time and patience do most of the work.'], x: 'A monthly SIP into an index fund is a simple, slow investing habit.', q: ['Investing is usually about…', ['Years, not minutes', 'Getting rich this week', 'Guessing tomorrow\'s price'], 0, 'Investing is long term. Trading is short term.'] },
    { id: 'l3', t: 'Investing versus trading', k: 'investing trading difference sebi loss', b: ['Investing holds for years. Trading holds for minutes to weeks and tries to profit from price moves.', 'Trading has higher costs, higher stress and higher risk. SEBI\'s studies of individual futures and options traders found that around 9 out of 10 made losses. That is why you practice with paper money first.'], x: 'Paper trading lets you make mistakes for free.', q: ['Why start with paper trading?', ['You can learn without losing real money', 'It always makes more profit', 'It is required by law'], 0, 'Practice shows your habits before real money is at risk.'] },
    { id: 'l4', t: 'NSE and BSE', k: 'nse bse nifty sensex exchange hours', b: ['India\'s two main stock exchanges are the NSE (National Stock Exchange) and the BSE (Bombay Stock Exchange). Most shares trade on both.', 'The Nifty 50 is the NSE\'s main index and the Sensex is the BSE\'s. Normal trading hours are about 9:15 am to 3:30 pm Indian time, Monday to Friday, except market holidays.'], x: 'Nifty 50 tracks 50 large companies listed on the NSE.', q: ['Which is the BSE\'s main index?', ['Sensex', 'Nifty 50', 'Bank Rate'], 0, 'Sensex is the BSE index; Nifty 50 belongs to the NSE.'] },
    { id: 'l5', t: 'Stocks and ETFs', k: 'etf stocks index fund diversify', b: ['A stock is one company. An ETF is a basket of many shares that tracks an index and trades on the exchange like a single share.', 'An ETF spreads your risk across many companies and usually has low costs. One stock can fall a lot if that one company has trouble.'], x: 'A Nifty 50 ETF holds all 50 Nifty companies in one purchase.', q: ['What is an ETF?', ['A basket of shares you buy as one unit', 'A loan from the broker', 'A type of bank account'], 0, 'ETFs hold many assets and trade like a stock.'] },
    { id: 'l6', t: 'Intraday trading', k: 'intraday day trading square off margin', b: ['Intraday means buying and selling the same day so nothing is held overnight.', 'It is fast, costs add up, and many beginners lose money. Brokers may offer extra buying power (margin), which also magnifies losses. As a beginner, do not use borrowed money or derivatives.'], x: 'Ten small trades a day means ten sets of brokerage and taxes.', q: ['A big danger for beginners in intraday trading is…', ['Borrowed buying power magnifying losses', 'Holding too long', 'Reading charts'], 0, 'Margin multiplies both gains and losses.'] },
    { id: 'l7', t: 'Swing trading', k: 'swing trading days weeks', b: ['Swing trading holds shares for several days to a few weeks to catch one move in a trend.', 'It needs fewer decisions than intraday trading, but overnight news can move the price against you, so the stop-loss and position size matter.'], x: 'Buy after a pullback in an uptrend and hold a few days toward the next resistance.', q: ['Swing trades usually last…', ['Days to weeks', 'Seconds', 'Decades'], 0, 'Swing trades sit between intraday and investing.'] },
    { id: 'l8', t: 'Candlestick charts', k: 'candlestick chart open high low close', b: ['Each candle shows four prices for a period: open, high, low and close. The thick part is the body (open to close); the thin lines are wicks (the high and low).', 'In India a green candle usually means the close was above the open, and red the opposite. Candles show what happened; they do not promise what comes next.'], x: 'A long lower wick means sellers pushed the price down but buyers brought it back up.', q: ['A candle\'s wick shows…', ['The high and low of the period', 'The company profit', 'The brokerage'], 0, 'The wicks are the highest and lowest prices reached.'] },
    { id: 'l9', t: 'Support and resistance', k: 'support resistance level', b: ['Support is a price area where falling prices have often stopped and bounced. Resistance is an area where rising prices have often stopped.', 'They are zones, not exact lines, and they can break. A stop-loss just below support is a common idea.'], x: 'A share bounced from 500 three times. Around 500 is a support zone.', q: ['Resistance is where price often…', ['Stops rising', 'Starts rising', 'Cannot move'], 0, 'Resistance is a ceiling where sellers have appeared before.'] },
    { id: 'l10', t: 'Trend analysis', k: 'trend uptrend downtrend higher highs', b: ['An uptrend has higher highs and higher lows. A downtrend has lower highs and lower lows. Sideways means neither.', 'Beginners often do better trading with the trend than against it, but trends end, so the stop-loss stays.'], x: 'Peaks at 100, 110, 120 with dips at 95, 103, 112 form an uptrend.', q: ['An uptrend shows…', ['Higher highs and higher lows', 'Lower lows only', 'No movement'], 0, 'That pattern defines an uptrend.'] },
    { id: 'l11', t: 'Moving averages', k: 'moving average sma ema 50 200', b: ['A moving average is the average closing price over the last N days. It smooths the noise and shows the direction.', 'Common ones are the 50 day and 200 day averages. Price above a rising average suggests strength. Averages lag, because they use past prices.'], x: 'The 20 day average adds the last 20 closes and divides by 20, then moves forward one day at a time.', q: ['A moving average mostly…', ['Smooths price and lags behind it', 'Predicts tomorrow exactly', 'Shows company profit'], 0, 'It is built from past prices, so it lags.'] },
    { id: 'l12', t: 'RSI and other indicators', k: 'rsi indicator overbought oversold', b: ['RSI (Relative Strength Index) is a number from 0 to 100 that compares recent gains with recent losses. A common setting uses 14 periods.', 'Above 70 is called overbought and below 30 oversold, but a strong trend can stay there for a long time. An indicator is one clue, not a signal to act on its own.'], x: 'RSI at 75 means price rose a lot recently. It does not mean the price must fall.', q: ['RSI above 70 means…', ['Price rose strongly lately, not a sure fall', 'You must sell', 'The company is bad'], 0, 'It describes recent strength only.'] },
    { id: 'l13', t: 'Stop-loss', k: 'stop loss exit risk', b: ['A stop-loss is the price where you exit a losing trade to limit the damage. You decide it before you enter, not after.', 'Do not move the stop further away because you hope. A small planned loss is the cost of doing business.'], x: 'Buy at 100, stop at 95. The most you plan to lose is 5 per share (plus costs).', q: ['When should you decide the stop-loss?', ['Before entering the trade', 'After the price falls', 'Never'], 0, 'Deciding early removes emotion.'] },
    { id: 'l14', t: 'Take-profit', k: 'take profit target exit', b: ['A target is the price where you plan to take profit. Setting it early stops greed from turning a win into a loss.', 'Some traders sell in parts. Whatever you choose, write it down before the trade.'], x: 'Entry 100, stop 95, target 110 gives a reward of 10 for a risk of 5.', q: ['Why set a target before you enter?', ['It plans the exit before emotions appear', 'It guarantees the price gets there', 'It removes brokerage'], 0, 'Targets are plans, not promises.'] },
    { id: 'l15', t: 'Risk to reward ratio', k: 'risk reward ratio', b: ['Reward to risk compares how much you can gain with how much you risk. Gain 10 for a risk of 5 is 2 to 1.', 'With 2 to 1 you can be right only 40% of the time and still break even before costs. Low ratios need a very high win rate.'], x: 'Entry 200, stop 190, target 230: risk 10, reward 30, ratio 3 to 1.', q: ['Entry 100, stop 95, target 110. The ratio is…', ['2 to 1', '1 to 2', '5 to 1'], 0, 'Reward 10 divided by risk 5 is 2.'] },
    { id: 'l16', t: 'Position sizing', k: 'position size quantity risk per trade capital', b: ['Position size means how many shares to buy. A simple rule: risk only a small percent of your capital (often 1%) on one trade.', 'Quantity = (capital × risk%) ÷ (entry − stop). With ₹1,00,000 capital, 1% risk is ₹1,000. Entry 500 and stop 480 risks ₹20 per share, so you buy 50 shares.'], x: 'The calculator on the Risk page does this for you.', q: ['Capital ₹1,00,000, risk 1%, risk per share ₹20. Quantity?', ['50', '500', '5'], 0, '1,000 divided by 20 is 50.'] },
    { id: 'l17', t: 'Trading psychology', k: 'psychology fear greed fomo revenge', b: ['Fear, greed and FOMO (fear of missing out) cause most beginner mistakes. After a loss, revenge trading tries to win it back quickly and usually makes it worse.', 'A written plan, small positions, a daily loss limit and breaks after losses protect you from your own emotions.'], x: 'Two losses in a row? Close the app and review before the next trade.', q: ['What is revenge trading?', ['Trading fast to win back a loss', 'Selling at a profit', 'Waiting for a signal'], 0, 'It is an emotional reaction to losing.'] },
    { id: 'l18', t: 'Common beginner mistakes', k: 'mistakes beginners overtrading leverage tips', b: ['Common mistakes: no stop-loss, risking too much per trade, trading too often, using borrowed money, following tips from social media, and not keeping a journal.', 'Never trade with emergency savings, rent money or loans. Keep your SIP and bills separate from trading money.'], x: 'A tip on a messaging group is not a plan. Check everything yourself.', q: ['Which money is okay to use for trading?', ['Only money you can afford to lose', 'Emergency savings', 'A loan'], 0, 'Only risk what you can lose without hurting your life.'] }
  ];
  function answerQ(text) {
    var words = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
    if (!words.length) return [];
    var sc = LESSONS.map(function (l) { var top = (l.t + ' ' + l.k).toLowerCase(), body = l.b.join(' ').toLowerCase(), s = 0; words.forEach(function (w) { if (w === 'what' || w === 'the' || w === 'and') return; var re = new RegExp('\\b' + w); if (re.test(top)) s += 3; else if (re.test(body)) s++; }); return [s, l]; })
      .filter(function (x) { return x[0] > 0; }).sort(function (a, b) { return b[0] - a[0]; });
    return sc.slice(0, 2).map(function (x) { return x[1]; });
  }

  var api = { DISCLAIMER: DISCLAIMER, DEF: DEF, LESSONS: LESSONS, num: num, r2: r2, cfgOf: cfgOf, fee: fee, okTrade: okTrade, okSym: okSym, isDate: isDate, addDays: addDays, pnl: pnl, account: account, stats: stats, rr: rr, sizePosition: sizePosition,
    limits: limits, checkBuy: checkBuy, priceHit: priceHit, weekly: weekly, explain: explain, answerQ: answerQ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  /* ================= screen ================= */
  var ctx = null, host = null, D = { docs: {} }, sub = 'home', openLesson = null, sub2 = {}, subscribed = false, LK = 'mywallet.trading.v1';
  function esc(s) { return ctx.esc(String(s == null ? '' : s)); }
  function money(v) { v = Number(v); return (v < 0 ? '-' : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cfg() { return cfgOf(D.docs.cfg); }
  function trades() { return Object.keys(D.docs).filter(function (k) { return k.indexOf('t_') === 0; }).map(function (k) { return D.docs[k]; }).filter(okTrade); }
  function watch() { return Object.keys(D.docs).filter(function (k) { return k.indexOf('w_') === 0; }).map(function (k) { return D.docs[k]; }).filter(function (w) { return w && okSym(w.sym); }); }
  function learn() { var l = D.docs.learn; return (l && l.done && typeof l.done === 'object') ? l.done : {}; }
  function loadLocal() { try { var o = JSON.parse(localStorage.getItem(LK) || '{}'); D.docs = (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch (e) { D.docs = {}; } }
  function put(id, obj) {
    D.docs[id] = obj;
    if (ctx.db) return ctx.db.collection('trading').doc(id).set(obj);
    try { localStorage.setItem(LK, JSON.stringify(D.docs)); } catch (e) { }
    return Promise.resolve();
  }
  function del(id) {
    delete D.docs[id];
    if (ctx.db) return ctx.db.collection('trading').doc(id).delete();
    try { localStorage.setItem(LK, JSON.stringify(D.docs)); } catch (e) { }
    return Promise.resolve();
  }
  function fail(e) { ctx.toast(ctx.failMsg ? ctx.failMsg(e) : 'Could not save'); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function val(id) { var e = host.querySelector('#' + id); return e ? e.value.trim() : ''; }
  function setOut(id, html) { var e = host.querySelector('#' + id); if (e) e.innerHTML = html; }
  function warnList(a) { return a.length ? '<ul class="tlist">' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; }

  var SUBS = [['home', 'Overview'], ['trade', 'Paper trade'], ['risk', 'Risk'], ['journal', 'Journal'], ['learn', 'Academy'], ['watch', 'Watchlist'], ['assist', 'Assistant']];
  var STRATS = ['Breakout', 'Pullback in trend', 'Support bounce', 'Trend following', 'Other'];

  function head() {
    return '<div class="tbanner" role="note"><b>' + DISCLAIMER + '</b><span>Practice with virtual money only. Nothing here moves your wallet, SIP or any real account, and no orders go to a broker.</span></div>' +
      '<div class="chips tnav" role="tablist">' + SUBS.map(function (s) { return '<button type="button" class="chipbtn" data-tsub="' + s[0] + '" aria-pressed="' + (sub === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div>';
  }
  function pnlSpan(v) { return '<span class="' + (v < 0 ? 'neg' : v > 0 ? 'pos' : '') + '">' + (v > 0 ? '+' : '') + money(v) + '</span>'; }

  function viewHome() {
    var c = cfg(), T = trades(), a = account(T, c), lim = limits(T, c, ctx.today), s = stats(T, c), done = Object.keys(learn()).length, open = T.filter(function (t) { return t.status === 'open'; });
    var h = '<div class="tcard"><h3>Practice account</h3><div class="tgrid"><div><div class="sub">Practice capital</div><b>' + money(c.capital) + '</b></div><div><div class="sub">Cash available</div><b>' + money(a.cash) + '</b></div>' +
      '<div><div class="sub">Open positions</div><b>' + money(a.openValue) + '</b></div><div><div class="sub">Equity</div><b>' + money(a.equity) + '</b></div>' +
      '<div><div class="sub">Realised profit / loss</div><b>' + pnlSpan(a.realized) + '</b></div><div><div class="sub">Open profit / loss</div><b>' + pnlSpan(a.unrealized) + '</b></div></div>' +
      '<p class="fine">Costs are estimates from your Risk settings (' + c.brokPct + '% + ' + money(c.fixedFee) + ' per order). Practice results are not real-world profits.</p></div>';
    var w = [];
    if (c.maxDaily > 0 && lim.dayLoss >= c.maxDaily) w.push('Daily loss limit reached (' + money(lim.dayLoss) + ' lost today).');
    if (c.maxWeekly > 0 && lim.weekLoss >= c.maxWeekly) w.push('Weekly loss limit reached.');
    if (lim.tradesToday >= c.maxTradesDay) w.push(lim.tradesToday + ' trade(s) today: that is your daily limit.');
    if (lim.lossStreak >= 2) w.push('Last ' + lim.lossStreak + ' closed trades were losses. Consider a break and a review.');
    if (!c.ack) w.push('Open the Risk page and confirm the safety statement.');
    h += '<div class="tcard"><h3>Today</h3>' + (w.length ? warnList(w) : '<p class="sub">No limit warnings. Daily loss so far: ' + money(lim.dayLoss) + ' of ' + money(c.maxDaily) + '. Trades today: ' + lim.tradesToday + ' of ' + c.maxTradesDay + '.</p>') + '</div>';
    h += '<div class="tcard"><h3>Open practice trades (' + open.length + ')</h3>' + (open.length ? open.map(function (t) { var hit = priceHit(t); return '<div class="plb"><div class="pln"><b>' + esc(t.sym) + '</b><span>' + t.qty + ' × ' + money(t.entry) + '</span></div><div class="sub">Stop ' + money(t.stop) + (t.target ? ' · Target ' + money(t.target) : '') + (t.last ? ' · Last price you typed ' + money(t.last) : ' · no price typed yet') + '</div>' + (hit ? '<div class="sub neg">' + (hit === 'stop' ? 'The price you typed is at or below your stop-loss.' : 'The price you typed reached your target.') + '</div>' : '') + '</div>'; }).join('') : '<p class="sub">None. Start on the Paper trade page.</p>') + '</div>';
    h += '<div class="tcard"><h3>Progress</h3><div class="sub">' + s.closed + ' closed trade(s), win rate ' + s.winRate + '%. Lessons finished: ' + done + ' of ' + LESSONS.length + '.</div><div class="pbar"><i style="width:' + Math.round(done / LESSONS.length * 100) + '%;background:var(--accent)"></i></div>' +
      '<div class="tfoot">Market prices are not connected. You type prices yourself, so nothing here is live or delayed market data.</div></div>';
    return h;
  }

  function viewTrade() {
    var c = cfg(), T = trades(), open = T.filter(function (t) { return t.status === 'open'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var h = '';
    if (!c.ack) h += '<div class="tcard twarn">Before you start: open the <b>Risk</b> page and confirm that practice and future trading use only money you can afford to lose.</div>';
    h += '<form class="tcard" id="tform" novalidate autocomplete="off"><h3>New practice buy</h3>' +
      '<div class="fld"><label for="tf-sym">Share code (NSE/BSE)</label><input id="tf-sym" maxlength="20" placeholder="e.g. RELIANCE" autocapitalize="characters"></div>' +
      '<div class="fld"><label for="tf-entry">Entry price</label><input id="tf-entry" inputmode="decimal"></div>' +
      '<div class="fld"><label for="tf-stop">Stop-loss (required)</label><input id="tf-stop" inputmode="decimal"></div>' +
      '<div class="fld"><label for="tf-target">Target (optional)</label><input id="tf-target" inputmode="decimal"></div>' +
      '<div class="fld"><label for="tf-qty">Quantity</label><input id="tf-qty" inputmode="numeric" placeholder="0"><button class="btn2" type="button" data-t="suggest" style="margin-top:6px">Suggest quantity from my risk limit</button></div>' +
      '<div class="fld"><label for="tf-date">Date</label><input id="tf-date" type="date" value="' + ctx.today + '"></div>' +
      '<div class="fld"><label for="tf-strat">Strategy</label><select id="tf-strat">' + STRATS.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></div>' +
      '<div class="fld"><label for="tf-why">Why this trade? (write it before you enter)</label><textarea id="tf-why" rows="2" maxlength="400"></textarea></div>' +
      '<div class="tsum" id="tf-prev" aria-live="polite"></div><p class="err" id="tf-err" role="alert"></p><button class="btn" type="submit">Place practice buy</button></form>';
    h += '<div class="tcard"><h3>Open practice trades (' + open.length + ')</h3>' + (open.length ? open.map(function (t) {
      var hit = priceHit(t);
      return '<div class="plb"><div class="pln"><b>' + esc(t.sym) + '</b><span>' + t.qty + ' × ' + money(t.entry) + '</span></div><div class="sub">' + esc(t.date) + ' · stop ' + money(t.stop) + (t.target ? ' · target ' + money(t.target) : '') + ' · ' + esc(t.strat || 'Other') + '</div>' +
        '<div class="sub">' + (t.last ? 'Last price you typed ' + money(t.last) + ' (' + esc(t.lastAt || '') + ') · open result ' : 'No price typed yet · ') + (t.last ? pnlSpan(pnl(t, c)) : '') + '</div>' +
        (hit ? '<div class="sub neg"><b>' + (hit === 'stop' ? 'Stop-loss reached at the price you typed. Review and close the trade.' : 'Target reached at the price you typed. Review and close the trade.') + '</b></div>' : '') +
        '<div class="prow"><input id="px-' + esc(t.id) + '" inputmode="decimal" placeholder="Price now" aria-label="Price now for ' + esc(t.sym) + '"><button class="btn2" type="button" data-t="px" data-id="' + esc(t.id) + '">Update price</button><button class="btn2" type="button" data-t="close" data-id="' + esc(t.id) + '">Sell / close at this price</button></div></div>';
    }).join('') : '<p class="sub">No open practice trades.</p>') + '</div>';
    return h;
  }

  function viewRisk() {
    var c = cfg(), a = account(trades(), c);
    return '<form class="tcard" id="rform" novalidate autocomplete="off"><h3>Risk settings</h3>' +
      '<div class="fld"><label for="rs-cap">Practice capital</label><input id="rs-cap" inputmode="decimal" value="' + c.capital + '"></div>' +
      '<div class="fld"><label for="rs-risk">Maximum risk per trade (% of capital, up to 5)</label><input id="rs-risk" inputmode="decimal" value="' + c.riskPct + '"></div>' +
      '<div class="fld"><label for="rs-day">Maximum loss per day</label><input id="rs-day" inputmode="decimal" value="' + c.maxDaily + '"></div>' +
      '<div class="fld"><label for="rs-wk">Maximum loss per week</label><input id="rs-wk" inputmode="decimal" value="' + c.maxWeekly + '"></div>' +
      '<div class="fld"><label for="rs-n">Maximum trades per day</label><input id="rs-n" inputmode="numeric" value="' + c.maxTradesDay + '"></div>' +
      '<div class="fld"><label for="rs-bp">Estimated brokerage and charges (% of trade value, each side)</label><input id="rs-bp" inputmode="decimal" value="' + c.brokPct + '"></div>' +
      '<div class="fld"><label for="rs-ff">Estimated fixed fee per order</label><input id="rs-ff" inputmode="decimal" value="' + c.fixedFee + '"></div>' +
      '<label class="tchk"><input type="checkbox" id="rs-ack"' + (c.ack ? ' checked' : '') + '> I understand: trading money must be separate from my emergency savings, expenses and SIP. I will not borrow money, use leverage or trade derivatives as a beginner.</label>' +
      '<p class="fine">Changing capital later keeps your closed trades. Cash available now: ' + money(a.cash) + '.</p><p class="err" id="rs-err" role="alert"></p><button class="btn" type="submit">Save risk settings</button></form>' +
      '<div class="tcard"><h3>Position size calculator</h3><div class="fld"><label for="pc-entry">Entry price</label><input id="pc-entry" inputmode="decimal"></div><div class="fld"><label for="pc-stop">Stop-loss</label><input id="pc-stop" inputmode="decimal"></div><div class="fld"><label for="pc-target">Target (optional)</label><input id="pc-target" inputmode="decimal"></div><div class="tsum" id="pc-out" aria-live="polite">Enter an entry price and a stop-loss.</div></div>';
  }

  function tradeRow(t, c) {
    var p = pnl(t, c);
    return '<div class="plb"><div class="pln"><b>' + esc(t.sym) + '</b><span>' + (t.status === 'closed' ? pnlSpan(p) : '<span class="pill">Open</span>') + '</span></div>' +
      '<div class="sub">' + esc(t.date) + (t.status === 'closed' ? ' to ' + esc(t.exitDate) + ' · ' + t.qty + ' × ' + money(t.entry) + ' → ' + money(t.exit) : ' · ' + t.qty + ' × ' + money(t.entry)) + ' · ' + esc(t.strat || 'Other') + '</div>' +
      (t.why ? '<div class="sub">Reason: ' + esc(t.why) + '</div>' : '<div class="sub">No reason written.</div>') +
      '<div class="fld" style="margin:8px 0 0"><label for="ls-' + esc(t.id) + '">Lesson learned</label><textarea id="ls-' + esc(t.id) + '" rows="2" maxlength="400">' + esc(t.lesson || '') + '</textarea></div>' +
      '<div class="prow"><button class="btn2" type="button" data-t="lesson" data-id="' + esc(t.id) + '">Save lesson</button><button class="btn2 danger" type="button" data-t="del" data-id="' + esc(t.id) + '">Delete</button></div></div>';
  }
  function viewJournal() {
    var c = cfg(), T = trades(), s = stats(T, c), wk = weekly(T, c, ctx.today);
    var h = '<div class="tcard"><h3>Last 7 days</h3>' + warnList(wk.lines) + '</div>';
    h += '<div class="tcard"><h3>Performance (practice only)</h3>' + (s.closed ? '<div class="tgrid"><div><div class="sub">Closed trades</div><b>' + s.closed + '</b></div><div><div class="sub">Win rate</div><b>' + s.winRate + '%</b></div><div><div class="sub">Average win</div><b>' + money(s.avgWin) + '</b></div><div><div class="sub">Average loss</div><b>' + money(s.avgLoss) + '</b></div><div><div class="sub">Reward to risk (avg)</div><b>' + (s.rr == null ? '-' : s.rr + ' to 1') + '</b></div><div><div class="sub">Max drawdown</div><b>' + money(s.maxDrawdown) + '</b></div><div><div class="sub">Net result</div><b>' + pnlSpan(s.net) + '</b></div><div><div class="sub">Open trades</div><b>' + s.open + '</b></div></div>' +
      '<h4>By strategy</h4>' + Object.keys(s.byStrategy).map(function (k) { var b = s.byStrategy[k]; return '<div class="pln"><span>' + esc(k) + '</span><span>' + b.n + ' trade(s), ' + Math.round(b.wins / b.n * 100) + '% wins, ' + pnlSpan(b.net) + '</span></div>'; }).join('') : '<p class="sub">Numbers appear after your first closed trade.</p>') +
      '<p class="fine">Win rate alone says little. Look at average win against average loss too. Practice results do not show what would happen with real money, where fear and slippage change behaviour.</p></div>';
    var all = T.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    h += '<div class="tcard"><h3>Trading journal (' + all.length + ')</h3>' + (all.length ? all.map(function (t) { return tradeRow(t, c); }).join('') : '<p class="sub">Your practice trades appear here with the reason and what you learned.</p>') + '</div>';
    return h;
  }

  function viewLearn() {
    var done = learn(), n = Object.keys(done).length;
    if (openLesson) {
      var l = LESSONS.filter(function (x) { return x.id === openLesson; })[0];
      if (l) {
        var q = l.q, prev = done[l.id];
        return '<div class="tcard"><button class="btn2" type="button" data-t="back">← All lessons</button><h3>' + esc(l.t) + '</h3>' + l.b.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '<p class="sub"><b>Example:</b> ' + esc(l.x) + '</p>' +
          '<h4>Quick quiz</h4><p>' + esc(q[0]) + '</p>' + q[1].map(function (o, i) { return '<button class="btn2 tq" type="button" data-t="ans" data-id="' + l.id + '" data-i="' + i + '">' + esc(o) + '</button>'; }).join('') + '<p class="sub" id="qres" aria-live="polite">' + (prev === 1 ? 'You answered this correctly before.' : '') + '</p>' +
          '<p class="fine">Educational content, not investment advice.</p></div>';
      }
    }
    return '<div class="tcard"><h3>Trading Academy</h3><div class="sub">' + n + ' of ' + LESSONS.length + ' lessons finished</div><div class="pbar"><i style="width:' + Math.round(n / LESSONS.length * 100) + '%;background:var(--accent)"></i></div>' +
      LESSONS.map(function (l, i) { return '<button type="button" class="tlesson" data-t="open" data-id="' + l.id + '"><span>' + (i + 1) + '. ' + esc(l.t) + '</span><span>' + (done[l.id] === 1 ? '✓' : '›') + '</span></button>'; }).join('') + '</div>';
  }

  function viewWatch() {
    var W = watch().sort(function (a, b) { return a.sym < b.sym ? -1 : 1; });
    return '<form class="tcard" id="wform" novalidate autocomplete="off"><h3>Add to watchlist</h3><div class="fld"><label for="wf-sym">Share code</label><input id="wf-sym" maxlength="20" autocapitalize="characters"></div>' +
      '<div class="fld"><label for="wf-up">Alert when price is at or above (optional)</label><input id="wf-up" inputmode="decimal"></div><div class="fld"><label for="wf-dn">Alert when price is at or below (optional)</label><input id="wf-dn" inputmode="decimal"></div><p class="err" id="wf-err" role="alert"></p><button class="btn" type="submit">Add</button></form>' +
      '<div class="tcard"><h3>My watchlist (' + W.length + ')</h3>' + (W.length ? W.map(function (w) {
        return '<div class="plb"><div class="pln"><b>' + esc(w.sym) + '</b><span>' + (w.last ? money(w.last) : 'no price yet') + '</span></div><div class="sub">' + (w.last ? 'Manual price, typed by you on ' + esc(w.lastAt || '') + '. Not live or delayed market data.' : 'No market data is connected. Type a price you looked up yourself.') + '</div>' +
          '<div class="sub">' + (w.up ? 'Alert at or above ' + money(w.up) + '. ' : '') + (w.dn ? 'Alert at or below ' + money(w.dn) + '.' : '') + '</div>' +
          '<div class="prow"><input id="wp-' + esc(w.id) + '" inputmode="decimal" placeholder="Price now" aria-label="Price for ' + esc(w.sym) + '"><button class="btn2" type="button" data-t="wpx" data-id="' + esc(w.id) + '">Update price</button><button class="btn2 danger" type="button" data-t="wdel" data-id="' + esc(w.id) + '">Remove</button></div></div>';
      }).join('') : '<p class="sub">Nothing here yet.</p>') + '<p class="fine">Alerts are checked when you type a new price and the app is open. They cannot reach you when the app is closed.</p></div>';
  }

  function viewAssist() {
    return '<div class="tcard"><h3>Explain a setup</h3><p class="sub">Type the numbers of a trade idea. You get an educational explanation, never a buy or sell signal.</p>' +
      '<div class="fld"><label for="as-entry">Entry price</label><input id="as-entry" inputmode="decimal"></div><div class="fld"><label for="as-stop">Stop-loss</label><input id="as-stop" inputmode="decimal"></div><div class="fld"><label for="as-target">Target (optional)</label><input id="as-target" inputmode="decimal"></div><div class="fld"><label for="as-qty">Quantity (optional)</label><input id="as-qty" inputmode="numeric"></div><div class="tsum" id="as-out" aria-live="polite">Enter an entry price and a stop-loss.</div></div>' +
      '<div class="tcard"><h3>Ask about a topic</h3><div class="fld"><label for="aq-q">Your question</label><input id="aq-q" maxlength="100" placeholder="e.g. what is a stop loss"></div><button class="btn2" type="button" data-t="ask">Find in lessons</button><div id="aq-out" class="sub" aria-live="polite"></div></div>' +
      '<div class="tcard"><p class="fine">This helper runs inside the app with fixed rules. Your numbers stay on your device and are not sent to any AI service. It does not know live prices, cannot predict the market, and is not financial advice.</p></div>';
  }

  function paint() {
    if (!host) return;
    var f = host.querySelector(':focus'), keep = f && f.id;
    var views = { home: viewHome, trade: viewTrade, risk: viewRisk, journal: viewJournal, learn: viewLearn, watch: viewWatch, assist: viewAssist };
    host.innerHTML = head() + '<div id="tview">' + views[sub]() + '</div>';
    if (sub === 'trade') paintPrev(); if (sub === 'risk') paintCalc(); if (sub === 'assist') paintAssist();
    if (keep) { var e = host.querySelector('#' + keep); if (e && e.focus) e.focus(); }
  }
  function tradeFromForm() {
    var t = num(val('tf-target'));
    return { sym: val('tf-sym').toUpperCase(), entry: num(val('tf-entry')), stop: num(val('tf-stop')), target: isFinite(t) ? t : null, qty: parseInt(val('tf-qty'), 10), date: val('tf-date') || ctx.today };
  }
  function paintPrev() {
    var t = tradeFromForm(), c = cfg(), T = trades();
    if (!(t.entry > 0)) { setOut('tf-prev', ''); return; }
    var out = '', q = t.qty > 0 ? t.qty : 0, cost = t.entry * q, f = q ? fee(cost, c) : 0;
    if (q) out += 'Cost ' + money(cost) + ' + estimated charges ' + money(f) + '. ';
    if (t.stop > 0 && t.stop < t.entry && q) out += 'Risk if stopped: ' + money((t.entry - t.stop) * q) + ' (limit ' + money(c.capital * c.riskPct / 100) + '). ';
    var ratio = t.target > 0 ? rr(t.entry, t.stop, t.target) : null; if (ratio !== null) out += 'Reward to risk ' + ratio + ' to 1. ';
    var k = checkBuy(t, T, c, ctx.today); var msgs = k.errors.concat(k.warnings);
    setOut('tf-prev', esc(out) + (msgs.length ? '<ul class="tlist">' + msgs.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' : ''));
  }
  function paintCalc() {
    var c = cfg(), e = num(val('pc-entry')), s = num(val('pc-stop')), tg = num(val('pc-target')), a = account(trades(), c);
    if (!(e > 0 && s > 0)) { setOut('pc-out', 'Enter an entry price and a stop-loss.'); return; }
    var z = sizePosition({ capital: c.capital, riskPct: c.riskPct, entry: e, stop: s, cash: a.cash, brokPct: c.brokPct });
    if (!z.qty && z.why) { setOut('pc-out', esc(z.why)); return; }
    var o = 'Quantity: <b>' + z.qty + '</b> share(s). Risk if stopped about ' + esc(money(z.riskAmount)) + ' (' + c.riskPct + '% of capital = ' + esc(money(c.capital * c.riskPct / 100)) + ').';
    if (z.limitedByCash) o += ' Limited by your available practice cash.';
    if (tg > 0) { var r = rr(e, s, tg); o += ' Reward to risk: ' + (r === null ? 'target must be above entry' : r + ' to 1') + '.'; }
    setOut('pc-out', o);
  }
  function paintAssist() {
    var c = cfg(), x = explain({ entry: num(val('as-entry')), stop: num(val('as-stop')), target: num(val('as-target')), qty: parseInt(val('as-qty'), 10) }, c);
    setOut('as-out', '<b>' + esc(x.title) + '</b>' + warnList(x.lines) + (x.risks.length ? '<div><b>Things to think about</b></div>' + warnList(x.risks) : ''));
  }

  function onClick(ev) {
    var b = ev.target.closest('button'); if (!b || !host.contains(b)) return;
    if (b.dataset.tsub) { sub = b.dataset.tsub; openLesson = null; paint(); return; }
    var a = b.dataset.t, id = b.dataset.id, t;
    if (!a) return;
    if (a === 'suggest') {
      var c = cfg(), e = num(val('tf-entry')), s = num(val('tf-stop')), z = sizePosition({ capital: c.capital, riskPct: c.riskPct, entry: e, stop: s, cash: account(trades(), c).cash, brokPct: c.brokPct });
      if (!z.qty) { setOut('tf-err', esc(z.why || 'The suggested quantity is 0. Check the prices or your available cash.')); return; }
      host.querySelector('#tf-qty').value = z.qty; setOut('tf-err', ''); paintPrev(); return;
    }
    if (a === 'px' || a === 'close') {
      t = D.docs[id]; if (!t || t.status !== 'open') return;
      var p = num(val('px-' + id)); if (!(p > 0)) { ctx.toast('Type a price above zero.'); return; }
      var n = Object.assign({}, t);
      if (a === 'px') { n.last = p; n.lastAt = ctx.today; put(id, n).then(function () { var h = priceHit(n); ctx.toast(h === 'stop' ? 'Stop-loss level reached at the price you typed (practice).' : h === 'target' ? 'Target reached at the price you typed (practice).' : 'Price saved'); paint(); }).catch(fail); }
      else {
        if (!confirm('Close ' + t.sym + ' at ' + p + ' in your practice account?')) return;
        n.status = 'closed'; n.exit = p; n.exitDate = ctx.today; n.last = p; n.lastAt = ctx.today; n.feesOut = fee(p * t.qty, cfg());
        put(id, n).then(function () { var r = pnl(n, cfg()); ctx.toast('Practice trade closed: ' + (r >= 0 ? '+' : '') + r2(r)); paint(); }).catch(fail);
      }
      return;
    }
    if (a === 'lesson') { t = D.docs[id]; if (!t) return; var l = val('ls-' + id).slice(0, 400); put(id, Object.assign({}, t, { lesson: l })).then(function () { ctx.toast('Lesson saved'); }).catch(fail); return; }
    if (a === 'del') { if (!confirm('Delete this practice trade from your journal? This cannot be undone.')) return; del(id).then(function () { paint(); }).catch(fail); return; }
    if (a === 'open') { openLesson = id; paint(); window.scrollTo(0, 0); return; }
    if (a === 'back') { openLesson = null; paint(); return; }
    if (a === 'ans') {
      var L = LESSONS.filter(function (x) { return x.id === id; })[0]; if (!L) return;
      var ok = parseInt(b.dataset.i, 10) === L.q[2], d = Object.assign({}, learn()); if (ok) d[id] = 1; else if (d[id] == null) d[id] = 0;
      setOut('qres', esc((ok ? 'Correct. ' : 'Not quite. ') + L.q[3]));
      put('learn', { done: d, t: Date.now() }).catch(fail); return;
    }
    if (a === 'wpx') {
      var w = D.docs[id]; if (!w) return; var q = num(val('wp-' + id)); if (!(q > 0)) { ctx.toast('Type a price above zero.'); return; }
      var nw = Object.assign({}, w, { last: q, lastAt: ctx.today }), msg = '';
      if (nw.up > 0 && q >= nw.up) msg = 'Alert: ' + nw.sym + ' is at or above ' + nw.up + ' (price typed by you).';
      if (nw.dn > 0 && q <= nw.dn) msg = 'Alert: ' + nw.sym + ' is at or below ' + nw.dn + ' (price typed by you).';
      put(id, nw).then(function () { ctx.toast(msg || 'Price saved'); paint(); }).catch(fail); return;
    }
    if (a === 'wdel') { del(id).then(paint).catch(fail); return; }
    if (a === 'ask') { var res = answerQ(val('aq-q')); setOut('aq-out', res.length ? res.map(function (l) { return '<p><b>' + esc(l.t) + '</b><br>' + esc(l.b[0]) + '</p>'; }).join('') : 'No matching lesson. Try a word like stop-loss, RSI, ETF or candlestick.'); }
  }
  function onInput(ev) {
    var id = ev.target.id || '';
    if (id.indexOf('tf-') === 0) paintPrev(); else if (id.indexOf('pc-') === 0) paintCalc(); else if (id.indexOf('as-') === 0) paintAssist();
  }
  function onSubmit(ev) {
    ev.preventDefault();
    var f = ev.target.id;
    if (f === 'tform') {
      var t = tradeFromForm(), c = cfg(), T = trades(), k = checkBuy(t, T, c, ctx.today);
      if (k.errors.length) { setOut('tf-err', esc(k.errors[0])); return; }
      if (k.warnings.length && !confirm('Warnings:\n\n- ' + k.warnings.join('\n- ') + '\n\nPlace this practice trade anyway?')) return;
      var id = 't_' + uid(), o = { id: id, sym: t.sym, qty: t.qty, entry: r2(t.entry), stop: r2(t.stop), date: t.date, status: 'open', strat: val('tf-strat'), why: val('tf-why').slice(0, 400), feesIn: fee(t.entry * t.qty, c), ts: Date.now() };
      if (t.target > 0) o.target = r2(t.target);
      put(id, o).then(function () { ctx.toast('Practice buy placed (no real money)'); paint(); }).catch(function (e) { fail(e); });
    } else if (f === 'rform') {
      var n = { capital: num(val('rs-cap')), riskPct: num(val('rs-risk')), maxDaily: num(val('rs-day')), maxWeekly: num(val('rs-wk')), maxTradesDay: parseInt(val('rs-n'), 10), brokPct: num(val('rs-bp')), fixedFee: num(val('rs-ff')) }, bad = '';
      if (!(n.capital > 0)) bad = 'Capital must be above zero.'; else if (!(n.riskPct > 0 && n.riskPct <= 5)) bad = 'Risk per trade must be above 0 and at most 5%.';
      else if (!(n.maxDaily >= 0 && n.maxWeekly >= 0)) bad = 'Loss limits cannot be negative.'; else if (!(n.maxTradesDay >= 1)) bad = 'Trades per day must be at least 1.';
      else if (!(n.brokPct >= 0 && n.brokPct <= 5 && n.fixedFee >= 0)) bad = 'Check the cost estimates.'; else if (!host.querySelector('#rs-ack').checked) bad = 'Please confirm the safety statement.';
      if (bad) { setOut('rs-err', esc(bad)); return; }
      n.ack = true; put('cfg', n).then(function () { ctx.toast('Risk settings saved'); paint(); }).catch(fail);
    } else if (f === 'wform') {
      var sym = val('wf-sym').toUpperCase(), up = num(val('wf-up')), dn = num(val('wf-dn'));
      if (!okSym(sym)) { setOut('wf-err', 'Enter the share code in capital letters.'); return; }
      if (watch().some(function (w) { return w.sym === sym; })) { setOut('wf-err', 'Already in your watchlist.'); return; }
      var wid = 'w_' + uid(), w = { id: wid, sym: sym, ts: Date.now() }; if (up > 0) w.up = up; if (dn > 0) w.dn = dn;
      put(wid, w).then(paint).catch(fail);
    }
  }

  function start(c, h) {
    ctx = c; host = h;
    if (!host.dataset.tr) { host.dataset.tr = '1'; host.addEventListener('click', onClick); host.addEventListener('input', onInput); host.addEventListener('change', onInput); host.addEventListener('submit', onSubmit); }
    if (!ctx.db) loadLocal();
    else if (!subscribed) {
      subscribed = true;
      ctx.db.collection('trading').onSnapshot(function (snap) {
        var d = {}; snap.docs.forEach(function (x) { d[x.id] = x.data(); }); D.docs = d;
        if (host && !host.querySelector('input:focus,textarea:focus,select:focus')) paint();
      }, function () { ctx.toast('Trading data could not be loaded.'); });
    }
    paint();
  }
  api.start = start;
  api.refresh = function (today) { if (ctx) { ctx.today = today; paint(); } };
  root.MWTrading = api;
})(typeof window !== 'undefined' ? window : null);
