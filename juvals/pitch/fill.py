#!/usr/bin/env python3
"""Fill the deck's [[PLACEHOLDERS]] from the research figures.

    python3 fill.py figures.json            writes index.html in place

figures.json is the "deck" object from the research synthesis (see RESEARCH.md): leaks, stats,
reviews, calendar, adBudget, roadmap, tiers, kpis and so on. Charts are drawn to scale from the
numbers. Anything left unfilled is reported, and the script refuses em or en dashes."""
import html
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
deck = json.loads(Path(sys.argv[1]).read_text())
page = (HERE / 'index.html').read_text()
e = lambda s: html.escape(str(s), quote=True)
DASH = re.compile('[–—]')


def short(url):
    m = re.match(r'https?://(?:www\.)?([^/]+)', url or '')
    return m.group(1) if m else url


def links(urls):
    seen, out = set(), []
    for u in urls:
        for x in re.findall(r'https?://[^\s,;)]+', u or ''):
            if x not in seen:
                seen.add(x)
                out.append('<a href="%s">%s</a>' % (e(x), e(short(x))))
    return ' · '.join(out)


F = {}

# 4 · leaks
for k in ('discover', 'decide', 'order', 'review'):
    F['LEAK_' + k.upper()] = e(deck['leaks'][k])

# 5 · numbers
for i, s in enumerate(deck['stats'][:4], 1):
    F['STAT%d_BIG' % i] = e(s['big'])
    F['STAT%d_TEXT' % i] = e(s['text'])
F['STATS_SRC'] = 'Sources: ' + links([s['source'] for s in deck['stats']])
F['STATS_NOTES'] = e(' '.join('%s: %s.' % (s['big'], s['text'].rstrip('.')) for s in deck['stats'][:4]))

# 7 · ordering
F['WEB_PROOF'] = e(deck['webProof'])

# 8 · review projection, drawn to scale
r = deck['reviews']
vals = [r['now'], r['m3'], r['m6'], r['m12']]
# three even gridlines at round numbers (e.g. 75, 150, 225), with 8% headroom
mag = 10 ** int(math.log10(max(vals) * 1.08 / 3))
top = next(3 * n * mag for n in (1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10) if 3 * n * mag >= max(vals) * 1.08)
top = int(top)
xs = [60, 217, 363, 500]
y = lambda v: 225 - (v / top) * 195
F['REV_Y1'], F['REV_Y2'], F['REV_Y3'] = (str(int(top / 3)), str(int(2 * top / 3)), str(int(top)))
F['REV_POINTS'] = ' '.join('%d,%.1f' % (x, y(v)) for x, v in zip(xs, vals))
dots = []
for x, v in zip(xs, vals):
    dots.append('<circle cx="%d" cy="%.1f" r="6" fill="#D8B67A" stroke="#211812" stroke-width="2"/>' % (x, y(v)))
    dots.append('<text x="%d" y="%.1f" text-anchor="middle" style="font-size:14px;font-weight:800">%s</text>' % (x, y(v) - 12, e(v)))
F['REV_DOTS'] = ''.join(dots)
F['REV_ARIA'] = e('now %s, month 3 %s, month 6 %s, month 12 %s' % tuple(vals))
F['REV_NOTE'] = e(r['assumption'])
F['REV_NOTES'] = e('Review projection: %s. %s' % (F['REV_ARIA'], r.get('source', '')))

# 9 · ads
cal = ''.join('<b>%s</b><span>%s</span>' % (e(c['when']), e(c['what'])) for c in deck['calendar'][:6])
page = page.replace('<p class="small">[[CALENDAR]]</p>', '<div class="cal">%s</div>' % cal)
F['ADS_BUDGET'] = e(re.sub(r'^\s*ad (money|budget)[^:]*:\s*', '', deck['adBudget'], flags=re.I))
F['ADS_SRC'] = 'Sources: ' + links([deck['adSources']])
F['ADS_NOTES'] = e('Ad money is paid by Juval\'s straight to Meta; our fee is separate. ' + deck['adBudget'])

# 10 · POS
F['POS_BIR'] = e(deck['posBir'])
F['POS_NOTES'] = e('Offer the Mogoba demo here. On BIR: ' + deck['posBir'])

# 11 · stock rows and food cost bars (illustration)
rows = [('Pork pata', '14 pcs', 14, 30, 'ok', ''), ('Chicken, cut', '9.2 kg', 9.2, 20, 'ok', ''),
        ('Fresh milk', '4 L', 4, 12, 'low', 'Expires tomorrow'), ('Pizza dough', '18 balls', 18, 40, 'ok', ''),
        ('Cucumber', '1.1 kg', 1.1, 6, 'out', 'Reorder today')]
col = {'ok': '#7FA36B', 'low': '#E8C14A', 'out': '#E0574F'}
html_rows = []
for name, qty, v, par, st, chip in rows:
    pct = max(4, min(100, v / par * 100))
    html_rows.append(
        '<div class="lv-row"><span class="lv-name">%s</span><span class="lv"><i style="width:%.0f%%;background:%s"></i></span>'
        '<span class="lv-qty num">%s</span><span class="lv-chip">%s</span></div>' % (e(name), pct, col[st], e(qty), e(chip)))
page = page.replace('[[STOCK_ROWS]]', '<div class="lv-list">%s</div>' % ''.join(html_rows))
for k, v in (('FC1', 36), ('FC2', 29), ('FC3', 24)):
    F[k] = '%.1f' % (v * 6.4)
    F[k + 'X'] = '%.1f' % (70 + v * 6.4 + 6)
F['FCT'] = '%.1f' % (70 + 35 * 6.4)

# 12 · labor % by hour (illustration) and DOLE line
labor = [62, 46, 31, 19, 16, 23, 36, 33, 21, 17, 19, 27, 44]
hours = ['9a', '10', '11', '12', '1p', '2', '3', '4', '5', '6', '7', '8', '9p']
bars = []
scale = 88 / 70.0
for i, (p, hlab) in enumerate(zip(labor, hours)):
    x = 24 + i * 29
    h = p * scale
    bars.append('<rect x="%d" y="%.1f" width="21" height="%.1f" rx="3" fill="%s"><title>%s: labor %d%% of sales</title></rect>'
                % (x, 94 - h, h, '#D8B67A' if p <= 25 else '#8E5A4E', hlab, p))
    if i % 2 == 0:
        bars.append('<text x="%.1f" y="108" text-anchor="middle" class="muted" style="font-size:10px">%s</text>' % (x + 10.5, hlab))
F['LABOR_BARS'] = ''.join(bars)
F['LABOR_T'] = '%.1f' % (94 - 25 * scale)
F['DOLE_LINE'] = e(deck['dole'])
F['STAFF_NOTES'] = e('Payroll is prepared, not filed: the owner or bookkeeper approves. ' + deck['dole'])

# 13 · loyalty
F['LOYAL_SRC'] = 'Guest numbers are kept only with consent (Data Privacy Act). Everyone can still review on Google.'
F['LOYAL_NOTES'] = 'No app for the guest. Consent when we take the number. Unhappy guests reach the manager, and still see the Google link.'

# 16 · roadmap
legs = []
for leg in deck['roadmap'][:4]:
    items = ''.join('<li>%s</li>' % e(i) for i in leg['items'][:4])
    legs.append('<div class="leg"><span class="hwsign">%s</span><ul class="ticks">%s</ul></div>' % (e(leg['when']), items))
F['ROADMAP'] = ''.join(legs)
F['ROADMAP_NOTES'] = 'Stage by stage. Each stage starts only when the one before it is used by the staff.'

# 17 · packages (presenter copy only)
tiers = []
for i, t in enumerate(deck['tiers'][:3]):
    best = i == 1
    inc = ''.join('<li>%s</li>' % e(x) for x in t['includes'][:6])
    tiers.append(
        '<div class="tier%s">%s<h3>%s</h3><p class="small">%s</p><div class="price">%s <small>/ month</small></div>'
        '<p class="setup">Setup %s</p><ul class="ticks">%s</ul></div>'
        % (' best' if best else '', '<span class="ribbon flag">Most pick this</span>' if best else '', e(t['name']),
           e(t.get('forWho', '')), e(t['monthly']), e(t['setup']), inc))
F['TIERS'] = ''.join(tiers)
F['HARDWARE'] = e(deck['hardware'])
F['PRICE_NOTES'] = 'Presenter only, not in the client PDF. Prices are starting points; ad spend and payment fees are paid by Juval\'s directly.'

# 18 · KPIs
kpis = []
for k in deck['kpis'][:6]:
    kpis.append('<tr><td><b>%s</b></td><td class="n">%s</td><td class="n gold">%s</td><td class="n gold">%s</td><td>%s%s</td></tr>'
                % (e(k['measure']), e(k['today']), e(k['m6']), e(k['m12']), e(k['why']), ' <span class="est">our estimate</span>' if k['estimate'] else ''))
F['KPI_ROWS'] = ''.join(kpis)
F['KPI_SRC'] = 'Sources: ' + links([deck.get('kpiSources', '')]) if 'http' in deck.get('kpiSources', '') else e(deck.get('kpiSources', ''))

for k, v in F.items():
    page = page.replace('[[%s]]' % k, v)
left = sorted(set(re.findall(r'\[\[([A-Z0-9_]+)\]\]', page)))
bad = DASH.findall(re.sub(r'<[^>]+>', '', page))
(HERE / 'index.html').write_text(page)
print('filled', len(F), 'placeholders; left:', left or 'none', '; dashes:', len(bad))
sys.exit(1 if left or bad else 0)
