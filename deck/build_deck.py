"""Build the 3-slide RISA Growth APM deck: deck.html, printed to RISA_Growth_Strategy.pdf by render.sh (Edge headless).

Style follows the HiLabs MedBench deck (hilabs/deck/be23b014_vedantshelkar_deck.pdf): same palette, Arial, navy title band,
navy pills, dotted sub-cards, blue formula lines and an auto-fit script. Style notes are kept outside this repository.

Every figure is read from model/target_model.json, model/bets.json or the 2025 analysis (analysis/derived/report_numbers.json), so the deck,
the README and the app agree. The per-bet thresholds on slide 3 are the agreed decision rules (README section 3).

Screenshot slots (replace the file and rerun; adjust SHOTS crop boxes if the layout moved):
  img/gc_home.png      Home at /?d=2025-03-29 (real Chrome, 1536x674 CSS px at 125%, panel closed)
  img/gc_diagnose.png  Diagnose & decide at /diagnose?d=2025-04-13 (same window)
  img/gc_analyst_reply.png  a live analyst answer to the first starter question (same window)
  img/gc_analyst.png   Ask the analyst panel (any page, 1470x900); swap in a draft-task confirm card when one is captured
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
TM = json.load(open(os.path.join(ROOT, 'model', 'target_model.json'), encoding='utf8'))
BT = json.load(open(os.path.join(ROOT, 'model', 'bets.json'), encoding='utf8'))
B, S, MC, CON = TM['base'], TM['stretch'], TM['monte_carlo'], TM['constraints']
TRI, ROB, CAL = TM['triangulation'], TM['city_robustness'], TM['calibration']
BETS = {b['key']: b for b in BT['bets']}

# Live app link on slide 1 (set APP_URL when the deployment URL changes)
APP_URL = os.environ.get('APP_URL', 'https://risa-apm-growth.vercel.app')
APP_HOST = APP_URL.split('://', 1)[-1].rstrip('/')


def f(n):
    return f'{int(round(n)):,}'


def lakh(n):
    return f'₹{n / 100000:.1f}L'


def r1000(n):
    return f(round(n, -3))


# 2025 facts used on the slides (from the 2025 analysis, analysis/derived/report_numbers.json)
Y25 = dict(visitors=2050, spend=274000, per_visitor=134, unconfirmed=300, reconf=36, reconf_att=26,
           late_share=47.5, late_cpr=67, early_cpr=126, paid_late_eff=0.67, creator_cpv=337,
           email_sent=700, email_open=75, pace=[('T-30', 0.525), ('T-14', 0.801), ('T-7', 0.922)],
           fc_err_t14=9.9, fc_err_t7=4.0, peer_t30='25–27%')

CSS = r"""
@page{size:1920px 1080px;margin:0}
/* RISA palette (risalabs.ai): black, blue #0F5BFF, off-white page; --navy is the darkest colour and is now black */
:root{--navy:#0A0A0A;--blue:#0F5BFF;--b2:#0A47D1;--lb:#C7D8FF;--lb2:#E2EBFF;--lb3:#EFF4FF;--ink:#0A0A0A;--line:#D9DDE5;--grey:#8A8A8A;--page:#FAFAFA;
--ok:#15803D;--okb:#DCFCE7;--am:#B45309;--amb:#FEF3C7;--rd:#DC2626;--rdb:#FEE2E2}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:var(--ink);background:#888}
.slide{width:1920px;height:1080px;background:var(--page);position:relative;overflow:hidden;page-break-after:always;break-after:page;display:flex;flex-direction:column}
/* tab strip (Flipkart deck pattern): wordmark left, deck sections right, this slide's sections in a black pill */
.strip{flex:none;height:62px;display:flex;align-items:center;justify-content:space-between;padding:0 26px;border-bottom:2px solid var(--navy)}
.wm{font-weight:700;font-size:34px;letter-spacing:-1px;color:var(--navy);white-space:nowrap}
.tabs{display:flex;align-items:center;gap:6px}
.tabs .t{font-weight:700;font-size:17px;letter-spacing:.06em;text-transform:uppercase;color:var(--grey);padding:8px 18px;white-space:nowrap}
.tabs .grp{display:flex;background:var(--navy);border-radius:999px;padding:0 4px}
.tabs .grp .t{color:#fff}
/* scale with transform, not zoom: Chromium's zoom leaves fr grid columns short of the right edge */
.content{flex:none;transform:scale(var(--z,1));transform-origin:0 0;width:calc(1920px / var(--z,1));height:calc(var(--h,996px) / var(--z,1));padding:12px 14px 12px;display:grid;gap:12px;min-height:0}
.box{border:2px solid var(--navy);border-radius:4px;padding:12px 14px;position:relative;min-height:0;min-width:0}
.content>*{min-width:0}
/* transform does not change layout size: give back the difference so anything after .content sits below its scaled box */
.content{margin-bottom:calc(var(--h,996px) - var(--h,996px) / var(--z,1))}
.pt{padding-top:34px}
.dot{border:2.5px dotted var(--blue);border-radius:8px;padding:10px 12px;min-height:0}
.pill{display:inline-block;background:var(--navy);color:#fff;font-weight:700;font-size:20px;padding:6px 22px;border-radius:12px;white-space:nowrap}
.pilltop{position:absolute;top:-2px;left:50%;transform:translateX(-50%);border-radius:0 0 14px 14px}
.vt{writing-mode:vertical-rl;transform:rotate(180deg);background:var(--navy);color:#fff;font-weight:700;font-size:20px;padding:14px 8px;border-radius:0 12px 12px 0;text-align:center}
h3{font-size:19px;font-weight:700;margin-bottom:4px;line-height:1.2}
p,li,td{font-size:16px;line-height:1.32} ul{padding-left:20px} li{margin:2px 0}
.b{font-weight:700} .bl{color:var(--blue);font-weight:700}
.f{font-style:italic;font-weight:700;color:var(--blue);font-size:16.5px;line-height:1.3}
table{border-collapse:collapse;width:100%}
.t th{background:var(--blue);color:#fff;font-size:16px;font-weight:700;text-align:left;padding:6px 8px;border:1px solid #fff;line-height:1.2}
.t td{padding:5px 8px;border:1px solid var(--line);vertical-align:middle}
.t td.c1{background:var(--lb2);font-weight:700}
.t td.n{text-align:right;white-space:nowrap} .t th.n{text-align:right}
.t tr.tot td{background:var(--navy);color:#fff;font-weight:700;border-color:var(--navy)}
.num{display:inline-flex;width:32px;height:32px;border-radius:50%;background:var(--navy);color:#fff;font-weight:700;font-size:17px;align-items:center;justify-content:center;flex:none}
.chip{display:inline-block;font-size:16px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap}
.c-red{background:var(--rdb);color:var(--rd)} .c-amb{background:var(--amb);color:var(--am)} .c-grn{background:var(--okb);color:var(--ok)} .c-bl{background:var(--lb2);color:var(--b2)} .c-nv{background:var(--navy);color:#fff}
.ico{width:22px;height:22px;flex:none;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle}
.node{background:var(--blue);color:#fff;border-radius:12px;padding:8px 10px;font-weight:700;font-size:16px;text-align:center;line-height:1.25;display:flex;align-items:center;justify-content:center;gap:8px}
.node.n{background:var(--navy)} .node.l{background:var(--lb);color:var(--navy)} .node.r{background:var(--blue);color:#fff}
.arrow{color:var(--navy);font-size:28px;font-weight:700;display:flex;align-items:center;justify-content:center}
.ra{color:var(--navy);font-size:28px;font-weight:900;line-height:1;text-align:center}
.lbox{background:var(--lb);border-radius:4px;padding:8px 12px}
.bign{font-weight:700;color:var(--blue);line-height:1;letter-spacing:-1px}
.lab{font-size:16px;font-weight:700;color:var(--navy)}
.col{display:flex;flex-direction:column;min-height:0}
.ev{display:flex;flex-direction:column;justify-content:space-evenly}
/* funnel chevrons */
.fun{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,1fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.12fr);gap:0;align-items:center}
.chev{color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 20px 0 30px;clip-path:polygon(0 0,calc(100% - 24px) 0,100% 50%,calc(100% - 24px) 100%,0 100%,24px 50%)}
.chev:first-child{clip-path:polygon(0 0,calc(100% - 24px) 0,100% 50%,calc(100% - 24px) 100%,0 100%);padding-left:16px}
.chev .k{font-size:16px;font-weight:700;line-height:1.15} .chev .v{font-size:29px;font-weight:700;line-height:1.1;letter-spacing:-.5px}
.conv{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,1fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.12fr);margin-top:6px}
.conv span{text-align:center;font-size:16px;font-weight:700;color:var(--b2)}
/* score ladder */
.sbar{height:22px;background:#EEF2F8;border-radius:4px;overflow:hidden} .sbar div{height:100%;background:var(--blue);border-radius:4px}
.gantt{display:grid;grid-template-columns:repeat(10,1fr);gap:2px;height:22px} .gantt i{background:#EEF2F8;border-radius:2px} .gantt i.d{background:var(--navy)} .gantt i.l{background:var(--lb)}
.gh{display:grid;grid-template-columns:repeat(10,1fr);gap:2px;text-align:center;font-size:14px;font-weight:700}
/* decision table: one header colour, every cell centred */
.dt th{text-align:center} .dt td{text-align:left;background:#fff}
.aud{border:2px solid var(--navy);border-collapse:collapse;height:100%}
.aud th{font-size:16px;font-weight:700;text-align:center;padding:5px 8px;border-bottom:2.5px dotted var(--blue)}
.aud td{padding:6px 8px;font-size:15.5px;line-height:1.28;border-top:2.5px dotted var(--blue);vertical-align:middle}
.aud th+th,.aud td+td{border-left:2.5px dotted var(--blue)}
.vsep{justify-self:center;width:0;height:78px;border-left:2.5px dotted var(--navy)}
.appbtn{display:inline-block;background:var(--navy);color:#fff;font-weight:700;font-size:21px;padding:12px 26px;border-radius:999px;text-decoration:none;white-space:nowrap}
/* key numbers: white on a black rounded label, centred */
.stat{display:inline-block;background:var(--navy);color:#fff;font-weight:700;font-size:32px;line-height:1.1;letter-spacing:-.5px;padding:6px 18px;border-radius:12px;white-space:nowrap}
.stat.sm{font-size:19px;padding:3px 12px;border-radius:999px;letter-spacing:0}
.cl{padding-left:18px;margin:0} .cl li{margin:0} .lbox .cl li{font-size:16px}
.dt th{font-size:17px} .dt th .ico{width:20px;height:20px;margin-right:6px;vertical-align:-4px}
/* checkpoint columns: pill on the line, then a dotted box with the title, a dotted rule and bullets */
.tlc{display:flex;flex-direction:column;align-items:center;gap:8px;position:relative;min-width:0}
.tlc .pl{font-weight:700;font-size:18px;border-radius:999px;padding:9px 0;width:100%;max-width:150px;text-align:center;position:relative;z-index:1}
.tlc .bx{border:2.5px dotted var(--blue);border-radius:8px;padding:8px 10px;width:100%;flex:1;display:flex;flex-direction:column}
.tlc .bx h4{font-size:17px;font-weight:700;text-align:center;line-height:1.2;padding-bottom:6px;border-bottom:2.5px dotted var(--blue);margin-bottom:6px}
.tlc .bx ul{padding-left:18px} .tlc .bx li{font-size:15.5px;line-height:1.28;margin:1px 0}
/* bet cards share rows across the five columns so the Test / KPI boxes line up */
.cards{display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:auto auto auto 1fr;gap:12px;min-height:0}
.cards>.dot{display:grid;grid-row:span 4;grid-template-rows:subgrid;row-gap:8px}
/* screenshots */
.shot{flex:none;width:100%;position:relative;overflow:hidden;border:2px solid var(--navy);border-radius:8px;background:#fff}
.shot img{position:absolute;display:block}
"""

FIT = """<script>
function over(c){
  if(c.scrollHeight>c.clientHeight+1||c.scrollWidth>c.clientWidth+1) return true;
  var els=c.querySelectorAll('.box,.dot,.lbox,.content>*');
  for(var i=0;i<els.length;i++){var e=els[i]; if(e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2) return true;}
  return false;}
function fit(c){var s=c.closest('.slide'),after=0,n=c.nextElementSibling;
  while(n){after+=n.getBoundingClientRect().height;n=n.nextElementSibling;}
  c.style.setProperty('--h',(s.getBoundingClientRect().bottom-c.getBoundingClientRect().top-after)+'px');
  var lo=0.8,hi=1.6;for(var k=0;k<16;k++){var m=(lo+hi)/2;c.style.setProperty('--z',m);if(over(c))hi=m;else lo=m;}c.style.setProperty('--z',(lo*0.985).toFixed(3));}
function run(){document.querySelectorAll('.content').forEach(fit);document.body.setAttribute('data-fit','1');}
if(document.fonts&&document.fonts.ready){document.fonts.ready.then(run);}else{run();}
window.addEventListener('beforeprint',run);
</script>"""

# Lucide icon paths (inline SVG, stroke = currentColor)
IC = {
 'grad': '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
 'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
 'home': '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
 'pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
 'brief': '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
 'ban': '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
 'train': '<rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16M12 3v8M8 19l-2 3M18 22l-2-3"/><circle cx="8" cy="15" r=".5"/><circle cx="16" cy="15" r=".5"/>',
 'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
 'cal': '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
 'msg': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
 'bld': '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
 'share': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
 'mega': '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
 'up': '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
 'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
 'stop': '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M8 12h8"/>',
 'x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
 'mail': '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
 'mic': '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
 'star': '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
 'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
 'ticket': '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
}


def ico(name, size=22, style=''):
    return '<svg class="ico" viewBox="0 0 24 24" style="width:%dpx;height:%dpx;%s">%s</svg>' % (size, size, style, IC[name])


# One tab per slide, named after the brief's three questions; only the current slide's tab is active.
TABS = [['Target'], ['Bets'], ['Signals']]


def bullets(x):
    """A list becomes bullet lines (no semicolons on the slides); a string stays as it is."""
    if isinstance(x, str):
        return x
    return '<ul class="cl">' + ''.join('<li>%s</li>' % i for i in x) + '</ul>'


def strip(active):
    """Header for every slide: RISA Labs in black on the left, the deck's sections as tabs, this slide's group in a black pill."""
    groups = ''
    for i, g in enumerate(TABS):
        tabs = ''.join('<span class="t">%s</span>' % t for t in g)
        groups += '<span class="grp">%s</span>' % tabs if i == active else tabs
    return '<div class="strip"><div class="wm">RISA Labs</div><div class="tabs">%s</div></div>' % groups


def head(active):
    return '<section class="slide">' + strip(active)


# ================================================================== SLIDE 1: how high can we aim
reach = dict(partners=120 * 300, ambassadors=200 * 250, organic=60_000,
             referrals=round(B['regs']['referrals'] / 0.25), paid=round(150_000 / 120 * 1000 / 4))
reach_total = sum(reach.values())
organic_cpa = round(B['regs']['organic'] * CAL['organic']['cpr_inr'] * 1.2 / B['attendees_by_channel']['organic'])
cpa = {b['key']: b['cost_per_attendee'] for b in BT['bets']}
cpa['organic'] = organic_cpa
CH = [  # key, icon, name, how we reach them, 2025 evidence
    ('partners', 'bld', 'Society partnerships', '120 × 300 students', ('₹69', '86%')),
    ('ambassadors', 'users', 'Campus ambassadors', '200 × 250 each', ('₹81', '75%')),
    ('organic', 'home', 'Host college + alumni', '45k people + search', ('₹56', '78%')),
    ('referrals', 'share', 'Referrals', '4 invites each', ('₹56', '79%')),
    ('paid', 'mega', 'Warm retargeting', '₹1.5L, ₹120 CPM', ('₹137', '50%')),
]
rows1 = ''
for k, ic, name, basis, ev in CH:
    regs, att = B['regs'][k], B['attendees_by_channel'][k]
    rows1 += ('<tr><td class="c1">%s%s<br><span style="font-weight:400">%s</span></td>'
              '<td class="n">%s</td><td class="n">%s</td><td class="n">%d%%</td><td class="n b">%s</td><td class="n">₹%d</td><td class="n">%s</td><td class="n">%s</td></tr>') % (
        '', name, basis, f(reach[k]), f(regs), round(att / regs * 100), f(att), cpa[k], ev[0], ev[1])
rows1 += ('<tr><td class="c1">%sWalk-ins<br><span style="font-weight:400">6.1%% of visitors</span></td>'
          '<td class="n">–</td><td class="n">–</td><td class="n">–</td><td class="n b">%s</td><td class="n">₹0</td><td class="n" colspan="2">125 of 2,050</td></tr>') % ('', f(B['walkins']))
rows1 += ('<tr class="tot"><td>Base plan</td><td class="n">%s</td><td class="n">%s</td><td class="n">%d%%</td><td class="n">%s</td><td class="n">₹%d</td><td class="n" colspan="2">%s spend</td></tr>') % (
    f(reach_total), f(B['registrations']), round(B['registered_attendees'] / B['registrations'] * 100), f(B['unique_attendees']), B['cac_per_attendee'], lakh(B['spend_inr']))

funnel = ('<div class="fun" style="height:104px">'
          '<div class="chev" style="background:var(--lb);color:var(--navy);height:104px"><div class="k">Reach</div><div class="v">%s</div></div>'
          '<div class="chev" style="background:var(--blue);height:96px"><div class="k">Registrations</div><div class="v">%s</div></div>'
          '<div class="chev" style="background:var(--blue);height:88px"><div class="k">Show up</div><div class="v">%s</div></div>'
          '<div class="chev" style="background:var(--b2);height:80px"><div class="k">Walk-ins</div><div class="v">+%s</div></div>'
          '<div class="chev" style="background:var(--navy);height:104px"><div class="k">Verified attendees</div><div class="v">%s</div></div></div>'
          '<div class="conv"><span></span><span>%.1f%% of reach</span><span>%d%% show-up</span><span>6.1%% of visitors</span><span>rounded to %s</span></div>') % (
    f(reach_total), f(B['registrations']), f(B['registered_attendees']), f(B['walkins']), f(B['unique_attendees']),
    B['registrations'] / reach_total * 100, round(B['show_up'] * 100), r1000(B['unique_attendees']))

# number line of independent checks (0 to the venue ceiling)
cap = CON['unique_cap']
marks = [(MC['P10'], 'P10', 'var(--lb)', 0), (B['unique_attendees'], 'Base', 'var(--blue)', 1), (MC['P90'], 'P90', 'var(--lb)', 0),
         (TRI['budget_over_blended_cac']['implied_attendees'], 'Budget bound', 'var(--navy)', 1), (S['unique_attendees'], 'Stretch', 'var(--blue)', 1),
         (cap, 'Venue ceiling', 'var(--rd)', 1)]


def nline():
    W, x0, x1 = 600, 14, 586
    sx = lambda v: x0 + (x1 - x0) * v / cap
    svg = ['<svg viewBox="0 0 %d 150" style="width:100%%;height:auto;display:block" font-family="Arial">' % W,
           '<rect x="%.1f" y="66" width="%.1f" height="16" rx="3" fill="#E3EBFE"/>' % (sx(MC['P10']), sx(MC['P90']) - sx(MC['P10'])),
           '<line x1="%d" y1="74" x2="%d" y2="74" stroke="#0B1E3F" stroke-width="2"/>' % (x0, x1)]
    for i, (v, lab, col, big) in enumerate(marks):
        x = sx(v)
        up = i in (1, 3, 5)
        svg.append('<circle cx="%.1f" cy="74" r="%d" fill="%s" stroke="#fff" stroke-width="2"/>' % (x, 9 if big else 6, col if col != 'var(--lb)' else '#2A6DF4'))
        anchor = {'Venue ceiling': 'end', 'Base': 'end', 'P10': 'end', 'Budget bound': 'middle', 'P90': 'start'}.get(lab, 'middle')
        if up:
            svg.append('<text x="%.1f" y="22" text-anchor="%s" font-size="19" font-weight="700" fill="#0B1E3F">%s</text>' % (x, anchor, lab))
            svg.append('<text x="%.1f" y="48" text-anchor="%s" font-size="22" font-weight="700" fill="#2A6DF4">%s</text>' % (x, anchor, f(v)))
        else:
            svg.append('<text x="%.1f" y="112" text-anchor="%s" font-size="19" font-weight="700" fill="#0B1E3F">%s</text>' % (x, anchor, lab))
            svg.append('<text x="%.1f" y="136" text-anchor="%s" font-size="20" font-weight="700" fill="#2A6DF4">%s</text>' % (x, anchor, f(v)))
    svg.append('</svg>')
    return ''.join(svg)


tor = list(TM['tornado'].items())[:3]
lo_all, hi_all = 6000, 10000
tor_html = ''
for name, v in tor:
    l = (v['low'] - lo_all) / (hi_all - lo_all) * 100
    w = (v['high'] - v['low']) / (hi_all - lo_all) * 100
    tor_html += ('<span>%s</span><div style="position:relative;height:30px;background:#EEF2F8;border-radius:3px">'
                 '<div style="position:absolute;left:%.1f%%;width:%.1f%%;top:0;bottom:0;background:var(--blue);border-radius:3px"></div>'
                 '<div style="position:absolute;left:%.1f%%;top:-3px;bottom:-3px;width:2px;background:var(--navy)"></div></div><span class="b">%s–%s</span>') % (
        name.split(' (')[0], l, w, (B['unique_attendees'] - lo_all) / (hi_all - lo_all) * 100, f(v['low']), f(v['high']))

AUD = [('grad', 'Delhi college students', '4.5L', 'P1', 'c-grn', 'The biggest pool, one metro ride away. Reached through their societies.'),
       ('home', 'Host college + alumni', '45k', 'P1', 'c-grn', 'Cheapest to reach, best show-up in 2025. They seed referrals.'),
       ('train', 'NCR satellite colleges', '2.5–3L', 'P2', 'c-amb', 'Too far to come alone. Reached via partner colleges with return buses.'),
       ('brief', 'Young professionals', '~10L', 'P3', 'c-bl', 'Not students. Pro-night passes only.'),
       ('ban', 'School seniors', '4.9L', 'Avoid', 'c-red', 'Under 18, no student ID for the gate.')]
# a table: solid outer border, dotted lines between rows and columns
aud = ('<table class="aud"><tr><th>Segment</th><th>Size</th><th>Priority</th></tr>' + ''.join(
    ('<tr><td><div style="display:grid;grid-template-columns:28px 1fr;gap:0 8px;align-items:start">%s<div><div class="b">%s</div><div>%s</div></div></div></td>'
     '<td class="b" style="color:var(--blue);font-size:18px;text-align:center;white-space:nowrap">%s</td>'
     '<td style="text-align:center"><span class="chip %s">%s</span></td></tr>') % (
        ico(i, 24, 'color:var(--blue);margin-top:2px'), n, why, s, c, p) for i, n, s, p, c, why in AUD) + '</table>')

cities = [('Delhi NCR', ROB['Delhi NCR']), ('Mumbai', ROB['Mumbai']), ('Bengaluru', ROB['Bengaluru'])]
city_bars = ''
for name, r in cities:
    w = r['capacity_cap'] / cap * 100
    col = 'var(--navy)' if r['capacity_cap'] >= S['unique_attendees'] else 'var(--rd)'
    city_bars += ('<span class="b">%s</span><div style="position:relative;height:24px;background:#EEF2F8;border-radius:3px">'
                  '<div style="width:%.1f%%;height:100%%;background:%s;border-radius:3px;color:#fff;font-weight:700;font-size:16px;display:flex;align-items:center;padding-left:8px">%s</div>'
                  '<div style="position:absolute;left:%.1f%%;top:-4px;bottom:-4px;width:3px;background:var(--blue)"></div></div>') % (
        name, w, col, f(r['capacity_cap']), S['unique_attendees'] / cap * 100)

S1 = """
<section class="slide">%(strip)s
<div style="display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,2fr) auto minmax(0,1fr);column-gap:22px;align-items:center;padding:12px 26px 4px">
<div style="justify-self:start;display:inline-flex;flex-direction:column;align-items:center"><a class="appbtn" href="%(app_url)s">Open the live Growth Center ↗</a><div style="margin-top:6px;font-size:17px;font-weight:700;text-align:center"><a href="%(app_url)s" style="color:var(--blue);text-decoration:none">%(app_host)s</a></div></div>
<div class="vsep"></div>
<div style="text-align:center"><div style="font-size:44px;font-weight:700;letter-spacing:-1px;line-height:1.1">RISA Growth APM Case Study 2026</div>
<div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:6px;font-size:21px;font-weight:700"><span>Challenge A</span><span style="width:2px;height:22px;background:var(--navy)"></span><span>Attendee Growth</span><span style="width:2px;height:22px;background:var(--navy)"></span><span>Delhi NCR</span><span style="width:2px;height:22px;background:var(--navy)"></span><img src="img/campusfest_logo.png" alt="CampusFest" style="height:30px"></div></div>
<div class="vsep"></div>
<div style="text-align:right;font-weight:700;font-size:19px;line-height:1.35">Vedant Vikas Shelkar<br>BE23B014, IIT Madras<br>be23b014@smail.iitm.ac.in</div>
</div>
<div style="padding:4px 26px 8px"><div class="bl" style="font-size:24px;margin-bottom:2px">Problem Statement</div><p style="font-size:22px;line-height:1.35">Run a major college fest in a Tier 1 Indian city and <b>maximise the number of people who actually attend</b>, on limited time, budget and team. Defend the highest target you can, as a base and a stretch.</p></div>
<div style="display:flex;background:var(--blue);margin:2px 0 4px"><div style="background:var(--navy);color:#fff;font-weight:700;font-size:21px;padding:10px 26px;text-align:center;line-height:1.2;margin-left:60px;display:flex;align-items:center;white-space:nowrap">How High<br>Can We Aim?</div>
<div style="color:#fff;font-weight:700;font-size:19.5px;padding:10px 22px;display:flex;align-items:center;line-height:1.35">%(base_r)s verified attendees for %(spend)s (₹%(cac)d each), and %(stretch_r)s if early signals earn a %(topup)s top-up. CampusFest 2025 drew %(v25)s on %(s25)s. The jump comes from moving spend to channels whose registrants actually show up.</div></div>
<div class="content" style="grid-template-columns:minmax(0,1.45fr) minmax(0,1fr) minmax(0,0.86fr)">

<div class="box pt col" style="gap:10px"><div class="pill pilltop">Base Case Funnel</div>
%(funnel)s
<div class="f">Show-up = 2025 rate × 1.05 reconfirmation × 0.85 haircut<br>Cost = 2025 ₹ per registration × 1.2 for Delhi</div>
<table class="t" style="flex:1"><tr><th>Channel</th><th class="n" style="width:80px">Reach</th><th class="n" style="width:64px">Regs</th><th class="n" style="width:70px">Show-up</th><th class="n" style="width:90px">Attendees</th><th class="n" style="width:78px">₹ / attendee</th><th class="n" style="width:82px">2025 ₹/reg</th><th class="n" style="width:88px">2025 show-up</th></tr>%(rows1)s</table>
</div>

<div style="display:grid;grid-template-rows:auto 1fr;gap:12px;min-height:0">
<div class="box pt col" style="gap:10px"><div class="pill pilltop">The Target</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;align-items:end;gap:16px">
<div><div class="lab">Base</div><div class="bign" style="font-size:50px">%(base_r)s</div></div>
<div><div class="lab">Stretch</div><div class="bign" style="font-size:50px;color:var(--navy)">%(stretch_r)s</div></div>
<div><div class="lab">Venue ceiling</div><div class="bign" style="font-size:50px;color:var(--navy)">%(cap)s</div></div></div>
<div class="lbox"><p><b>Stretch needs:</b> 160 partners × 36 registrations (base 120 × 25), 280 ambassadors × 25 (base 200 × 20), a 10%% reconfirmation lift, and the %(topup)s released only at T-21 if pace and cost pass slide 3.</p></div>
</div>
<div class="box pt col ev" style="gap:8px"><div class="pill pilltop">Why Believe %(base_r)s</div>
%(nline)s
<p><b>%(mcp)d%%</b> of %(runs)s simulated plans reach the base. It is <b>%(share).1f%%</b> of the 7 lakh students in reach, while peer fests get 1.5–3%%. Budget bound: ₹11L ÷ ₹104, the 2025 cost per visitor in the five best channels.</p>
<div class="lab" style="margin-top:2px">What moves the number most</div>
<div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px 10px;align-items:center;font-size:16px">%(tor)s</div>
</div>
</div>

<div style="display:grid;grid-template-rows:1.4fr 1fr;gap:12px;min-height:0">
<div class="box pt col" style="gap:8px"><div class="pill pilltop">Who We Target</div><div style="flex:1;min-height:0">%(aud)s</div></div>
<div class="box pt col ev" style="gap:8px"><div class="pill pilltop">Why Delhi NCR</div>
<p style="display:flex;gap:10px;align-items:center">%(i_pin)s<span><b>7 lakh students</b> within an hour, on one metro</span></p>
<p style="display:flex;gap:10px;align-items:center">%(i_sh)s<span><b>Known permits:</b> Delhi Police SOP, QR passes</span></p>
<p style="display:flex;gap:10px;align-items:center">%(i_cal)s<span><b>Early February,</b> after the smog season</span></p>
<div class="lab">Venue ceiling vs the stretch (blue line)</div>
<div style="display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center">%(city)s</div>
<p>The base barely moves by city: Delhi %(d)s, Mumbai %(m)s, Bengaluru %(bl)s. The venue ceiling decides.</p>
</div>
</div>
</div>
<div style="flex:none;padding:0 26px 10px;font-size:17px;line-height:1.35"><b>How the three numbers are set.</b> The funnel model gives %(base)s verified attendees for %(spend)s, which we round to %(base_r)s. With the stretch inputs it gives %(stretch)s for %(sspend)s, rounded to %(stretch_r)s. The venue holds 15,000 people a day. We cap passes at 90%%, the fest runs two days and 35%% of people come on both, so 15,000 × 90%% × 2 ÷ 1.35 = %(cap)s unique attendees at most.</div>
</section>
""" % dict(strip=strip(0), app_url=APP_URL, app_host=APP_HOST, base_r=r1000(B['unique_attendees']), stretch_r=r1000(S['unique_attendees']), spend=lakh(B['spend_inr']), sspend=lakh(S['spend_inr']),
           cac=B['cac_per_attendee'], topup=lakh(S['budget_inr'] - B['budget_inr']), v25=f(Y25['visitors']), s25='₹%.2fL' % (Y25['spend'] / 1e5),
           funnel=funnel, rows1=rows1, cap=f(cap), base=f(B['unique_attendees']), stretch=f(S['unique_attendees']),
           nline=nline(), mcp=round(MC['prob_ge_base'] * 100), runs='20,000', share=TRI['penetration_of_1hr_students']['implied_share'] * 100,
           tor=tor_html, aud=aud, i_pin=ico('pin', 26, 'color:var(--blue)'), i_sh=ico('shield', 26, 'color:var(--blue)'), i_cal=ico('cal', 26, 'color:var(--blue)'),
           city=city_bars, d=f(ROB['Delhi NCR']['unique_attendees']), m=f(ROB['Mumbai']['unique_attendees']), bl=f(ROB['Bengaluru']['unique_attendees']))

# ================================================================== SLIDE 2: where we place our bets
ORDER = ['showup', 'partners', 'referrals', 'ambassadors', 'paid']
SHORT = {'showup': ('Show-up engine', 'msg'), 'partners': ('College &amp; society partnerships', 'bld'), 'referrals': ('Referral squads', 'share'),
         'ambassadors': ('Campus ambassadors', 'users'), 'paid': ('Warm paid retargeting', 'mega')}
CALL = {'showup': ('Double down', 'c-grn'), 'partners': ('Double down', 'c-grn'), 'referrals': ('Double down', 'c-grn'),
        'ambassadors': ('Fund for volume', 'c-amb'), 'paid': ('Capped, kill switch', 'c-red')}
# weeks 1-10: l = setting up or light spend, d = main push (team and timeline from the plan)
GANTT = {'showup': 'lllllllldd', 'partners': 'llddddddd.', 'referrals': '..dddddddd', 'ambassadors': 'ldddddddd.', 'paid': 'lllllldddd'}
TEAM = {'showup': '1 ops lead + WhatsApp Business API', 'partners': '3 partnership managers', 'referrals': '1 PM + 1 developer',
        'ambassadors': '2 coordinators', 'paid': '1 performance marketer'}
maxs = max(BETS[k]['ev_per_lakh'] for k in ORDER)


def gantt(code):
    return '<div class="gantt">' + ''.join('<i class="%s"></i>' % ({'l': 'l', 'd': 'd'}.get(c, '')) for c in code) + '</div>'


lad = ''
for i, k in enumerate(ORDER, 1):
    b = BETS[k]
    nm, ic = SHORT[k]
    lad += ('<tr><td style="text-align:center"><span class="num">%d</span></td><td class="b"><div style="display:flex;gap:8px;align-items:center">%s%s</div></td>'
            '<td><div style="display:grid;grid-template-columns:1fr 46px;gap:8px;align-items:center"><div class="sbar"><div style="width:%.1f%%"></div></div><b>%d</b></div></td>'
            '<td style="text-align:center"><span class="stat sm">%s%s</span></td><td class="n">%s</td><td class="n">₹%d</td><td class="n">%.2f</td>'
            '<td>%s</td><td>%s</td><td><span class="chip %s">%s</span></td></tr>') % (
        i, ico(ic, 22, 'color:var(--blue)'), nm, b['ev_per_lakh'] / maxs * 100, b['ev_per_lakh'],
        '+' if k == 'showup' else '', f(b['attendees']), lakh(b['cost']), b['cost_per_attendee'], b['conf'], TEAM[k], gantt(GANTT[k]), CALL[k][1], CALL[k][0])
chan = sum(BETS[k]['attendees'] for k in ORDER if k != 'showup')
bet_cost = sum(BETS[k]['cost'] for k in ORDER)

CARDS = {
 'showup': ('Reconfirm every registrant on WhatsApp at T-7 and T-3, issue a named QR pass, and release unclaimed seats at T-2.',
            '0 of 300', 'registrants unconfirmed at T-1 attended in 2025, while 26 of 36 who reconfirmed did.',
            'A/B on the first 1,000 registrants', ['share confirmed by T-3', 'show-up gap vs control']),
 'partners': ('Sign college societies and fest committees. Members register together on a group pass, with return transport for NCR colleges.',
              '86% show-up', 'and ₹69 per registration in 2025, the best of all seven channels.',
              '15 pilot societies in weeks 1–2', ['signed partners', 'group commitments per partner']),
 'referrals': ('Every registrant gets a link. A squad of three registered friends gets fast-lane entry.',
               '₹56 / reg', 'the cheapest 2025 channel, and it costs nothing until a friend registers.',
               'reward A/B: fast-lane vs merch', ['invites per registrant', 'k-factor']),
 'ambassadors': ('200 ambassadors across Delhi and NCR colleges, paid per verified attendee instead of per sign-up.',
                 '2,678', 'attendees, the largest single source, with 75% show-up in 2025.',
                 '50-ambassador pilot: per-attendee pay vs stipend', ['active share', 'registrations per ambassador a week']),
 'paid': ('Retarget warm audiences only (site visitors, form starters) and hold 70% of the paid budget for the last 30 days.',
          '₹67 vs ₹126', 'per registration in the last 30 days vs before. 47.5% of 2025 registrations came then.',
          'weekly geo holdout', ['cost per registration', 'landing page → registration']),
}
cards = ''
for i, k in enumerate(ORDER, 1):
    c = CARDS[k]
    nm, ic = SHORT[k]
    cards += ('<div class="dot"><div style="display:flex;gap:8px;align-items:center"><span class="num">%d</span><h3 style="margin:0">%s</h3></div>'
              '<p>%s</p><div style="text-align:center"><span class="stat">%s</span><p style="margin-top:6px">%s</p></div>'
              '<div class="lbox"><p><b>Test:</b> %s</p><p style="margin-top:3px"><b>KPI</b></p>%s</div></div>') % (i, nm, c[0], c[1], c[2], c[3], bullets(c[4]))

REJ = [('star', 'Creator and influencer deals', 'Worst 2025 channel: ₹337 per visitor and 50% show-up.'),
       ('mail', 'Nurture email to unregistered leads', '700 emailed, 75% opened, 0 registered.'),
       ('mega', 'Cold paid-social prospecting', 'The only channel that got less efficient late in the season (0.67×), with 50% show-up.'),
       ('mic', 'A celebrity pro-night as the hook', 'The fee would exceed the marketing budget and puts the crowd risk at the gate.')]
rej = ''.join(('<div class="node r" style="justify-content:flex-start;font-size:16px;text-align:left">%s%s</div><div class="ra">➜</div>'
               '<div class="lbox"><p>%s</p></div>') % (ico(i, 22), n, w) for i, n, w in REJ)

S2 = head(1) + """
<div class="content" style="grid-template-rows:auto 1fr auto">
<div class="box" style="display:grid;grid-template-columns:48px 1fr;gap:12px;padding:10px 12px">
<div class="vt">Prioritisation</div>
<div class="col" style="gap:6px">
<div class="f" style="font-size:18px">Score = expected attendees × confidence ÷ cost in ₹ lakh, where confidence is how well the 2025 evidence carries over</div>
<table class="t"><tr><th style="width:52px">#</th><th>Bet</th><th style="width:300px">Score per ₹1L</th><th style="text-align:center">Attendees</th><th class="n">Budget</th><th class="n">₹ / attendee</th><th class="n">Confidence</th><th>Team</th><th style="width:250px">Weeks 1–10 (dark = main push)</th><th>Call</th></tr>
%(lad)s
<tr class="tot"><td></td><td colspan="9">%(chan)s from the four channel bets + %(org)s host college and search + %(wi)s walk-ins = %(tot)s attendees for %(spend)s of the ₹11L budget, ₹%(cac)d each. The show-up engine's +%(su)s is already inside the channel rates.</td></tr></table>
<p><b>Why this order:</b> bets 1–3 are cheap and proven in the 2025 data, so we double down. Ambassadors bring the most volume but cost more per attendee. Paid stays capped and can be switched off in a week.</p>
</div></div>

<div class="cards">%(cards)s</div>

<div style="display:grid;grid-template-columns:1.25fr 1fr;gap:12px;min-height:0">
<div class="box pt"><div class="pill pilltop">What We Won't Do, and Why</div>
<div style="display:grid;grid-template-columns:360px 34px 1fr;gap:7px 6px;align-items:center;margin-top:6px">%(rej)s</div></div>
<div class="box pt col" style="gap:8px"><div class="pill pilltop">How the Bets Depend on Each Other</div>
<div style="display:grid;grid-template-columns:1fr 34px 1fr 34px 1fr;gap:6px;align-items:center;margin-top:6px">
<div class="col" style="gap:6px"><div class="node">%(i_bld)s Partnerships</div><div class="node">%(i_us)s Ambassadors</div></div>
<div class="arrow">→</div><div class="node n" style="height:100%%;flex-direction:column;gap:2px"><span style="font-size:26px">%(seed)s</span>registrants</div>
<div class="arrow">→</div><div class="node l" style="height:100%%">%(i_sh)s Referrals ride on them</div></div>
<div class="col ev" style="flex:1;gap:6px"><p style="display:flex;gap:10px">%(i_msg)s<span><b>Show-up engine</b> needs a WhatsApp number and consent at every registration.</span></p>
<p style="display:flex;gap:10px">%(i_cal)s<span><b>Peer channels register late</b> (%(peer)s by T-30 in 2025), so weeks 1–4 judge them on commitments, not volume.</span></p>
<p style="display:flex;gap:10px">%(i_tk)s<span><b>Passes stop at 90%% of capacity.</b> The rest join a waitlist released at T-2.</span></p></div>
</div></div>
</div></section>
""" % dict(lad=lad, chan=f(chan), org=f(BT['organic_baseline']), wi=f(BT['walkins']), tot=f(chan + BT['organic_baseline'] + BT['walkins']),
           spend=lakh(B['spend_inr']), cac=B['cac_per_attendee'], su=f(BT['showup_increment']), cards=cards, rej=rej,
           i_bld=ico('bld', 20), i_us=ico('users', 20), i_msg=ico('msg', 24, 'color:var(--blue)'), i_cal=ico('cal', 24, 'color:var(--blue)'), i_tk=ico('ticket', 24, 'color:var(--blue)'), i_sh=ico('share', 20), seed=f(B['regs']['partners'] + B['regs']['ambassadors']), peer=Y25['peer_t30'])

# ================================================================== SLIDE 3: how we know what's working
regs_t = B['registrations']
pace = {t: int(round(regs_t * s, -1)) for t, s in Y25['pace']}
TL = [  # label, headline, bullet points, pill colour
    ('Week 1', 'Launch', ['Tests split into test and control', 'Baselines set'], 'var(--lb)'),
    ('Week 3', 'First read', ['≥ 40 partners signed', '≥ 60% of ambassadors active'], 'var(--blue)'),
    ('T-30', '≥ %s registrations' % f(pace['T-30']), ['52.5% of the final count, as in 2025'], 'var(--blue)'),
    ('T-21', 'Stretch gate', ['≥ 105% of pace', '≤ ₹120 per attendee', 'Both pass: release %s' % lakh(S['budget_inr'] - B['budget_inr'])], 'var(--navy)'),
    ('T-14', '≥ %s registrations' % f(pace['T-14']), ['Forecast now within %.1f%%' % Y25['fc_err_t14']], 'var(--blue)'),
    ('T-7', '≥ %s registrations' % f(pace['T-7']), ['Forecast within %.1f%%' % Y25['fc_err_t7']], 'var(--blue)'),
    ('T-3', '≥ 70% confirmed', ['If not, SMS plus an ambassador call'], 'var(--blue)'),
    ('Fest', 'Verified check-ins', ['The number we are judged on'], 'var(--navy)'),
]
tl = '<div style="position:relative;display:grid;grid-template-columns:repeat(%d,1fr);gap:12px;align-items:stretch">' % len(TL)
tl += '<div style="position:absolute;left:4%;right:4%;top:19px;height:4px;background:var(--navy)"></div>'
for lab, h, pts, col in TL:
    fg = 'var(--navy)' if col == 'var(--lb)' else '#fff'
    tl += ('<div class="tlc"><div class="pl" style="background:%s;color:%s">%s</div>'
           '<div class="bx"><h4>%s</h4><ul>%s</ul></div></div>') % (col, fg, lab, h, ''.join('<li>%s</li>' % x for x in pts))
tl += '</div>'

RULES = [
 ('Show-up engine', ['Confirmation rate', 'WhatsApp blocks us if we over-message'], ['Share confirmed by T-3', 'Show-up gap vs control'],
  'Gap ≥ 5 pp → every registrant, plus a T-1 call for groups', 'Under 70% confirmed at T-3 → SMS plus an ambassador call', 'Opt-outs over 3% → halve messages, keep the T-3 touch'),
 ('Partnerships', 'Societies sign but don\'t push', ['Week 3: partners signed', 'Group commitments per partner'],
  '≥ 15 registrations per partner by week 5 → add 40 partners', '8–15 → bigger group-pass discount, visit in person', 'Under 5 by week 6 → stop new outreach, keep the top 30'),
 ('Referrals', 'Fake friends gaming the reward', ['Invites per registrant (week 4)', 'k-factor (week 5)'],
  'k ≥ 0.15 → squad pass on every confirmation', 'k 0.08–0.15 → try merch instead of fast-lane', 'k under 0.05 → fold the reward into group passes'),
 ('Ambassadors', 'A long tail of inactive ambassadors', ['Week 3: active share', '≥ 3 registrations each a week'],
  '≥ 60% active and ≤ ₹150 per attendee → recruit 100 more', '40–60% active → prune, re-brief, pair with top performers', 'Under 40% → keep the top 80, move money to partnerships'),
 ('Paid retargeting', 'Late CPMs push cost up', ['Weekly ₹ per registration', 'Landing page → registration'],
  '≤ ₹120 per registration → add ₹50k from the reserve', '₹120–200 → new creative and audience', 'Over ₹200 two weeks running → stop, money to bets 1–2'),
]
rr = ''.join(('<tr><td class="c1"><div style="display:flex;gap:8px;align-items:center"><span class="num" style="width:30px;height:30px;font-size:17px">%d</span>%s</div></td>'
              '<td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>') % ((i, r[0]) + tuple(bullets(x if isinstance(x, list) else [x]) for x in r[1:])) for i, r in enumerate(RULES, 1))

# screenshot slots: file, source width, crop box (x, y, w, h) in source pixels
SHOTS = {
    'home': ('img/gc_home.png', 1920, (300, 165, 1560, 677)),
    'diagnose': ('img/gc_diagnose.png', 1920, (300, 160, 1310, 682)),
    'analyst': ('img/gc_analyst.png', 1470, (1086, 126, 364, 500)),
    'reply': ('img/gc_analyst_reply.png', 1920, (1435, 145, 475, 687)),
}


def shot(key):
    src, sw, (x, y, w, h) = SHOTS[key]
    return ('<div class="shot" style="aspect-ratio:%d/%d"><img src="%s" style="width:%.3f%%;left:-%.3f%%;top:-%.3f%%"></div>') % (
        w, h, src, sw / w * 100, x / w * 100, y / h * 100)


def gcard(n, title, img):
    return ('<div class="col" style="gap:8px;min-height:0"><div style="display:flex;gap:8px;align-items:center"><span class="num">%d</span><h3 style="margin:0">%s</h3></div>%s</div>') % (n, title, img)


S3 = head(2) + """
<div class="content" style="grid-template-rows:auto auto 1fr">
<div class="box pt"><div class="pill pilltop">Checkpoints Every Monday, Against the 2025 Pace Curve</div>
<div style="margin-top:6px">%(tl)s</div>
<div class="f" style="margin-top:10px;text-align:center">Two Mondays below 90%% of the pace line → move reserve budget to the bet with the lowest ₹ per verified attendee. Projected cost must stay ≤ ₹150 per attendee (plan: ₹%(cac)d).</div>
</div>
<div class="box" style="padding:10px 12px"><table class="t dt"><tr><th style="width:215px">Bet</th><th style="width:250px">Biggest risk</th><th style="width:290px">Early signal</th><th class="sc">%(i_up)sScale</th><th class="ch">%(i_rf)sChange</th><th class="st">%(i_st)sStop</th></tr>%(rr)s</table></div>
<div class="box pt" style="display:grid;grid-template-columns:minmax(0,%(c1).2ffr) minmax(0,%(c2).2ffr) minmax(0,%(c3).2ffr) minmax(0,1.15fr);gap:16px;align-items:start"><div class="pill pilltop">The Growth Center Runs These Rules</div>
%(g1)s%(g2)s%(g3)s
<div class="col" style="gap:12px;align-self:center">
<p style="display:flex;gap:10px">%(i_up2)s<span><b>Works with any dataset.</b> Drop a file and it is read, cleaned, mapped and analysed on its own.</span></p>
<p style="display:flex;gap:10px">%(i_rf2)s<span><b>Pace and ₹ per verified attendee</b> per campaign, with editable thresholds, updated as data changes.</span></p>
<p style="display:flex;gap:10px">%(i_msg)s<span><b>The analyst</b> answers from live data, shows the numbers behind a breach, and says when the data cannot answer.</span></p>
<p style="display:flex;gap:10px">%(i_x)s<span><b>Nothing changes</b> until a person confirms the card.</span></p>
</div>
</div>
</div></section>
""" % dict(tl=tl, cac=B['cac_per_attendee'], rr=rr,
           i_up=ico('up', 20), i_rf=ico('refresh', 20), i_st=ico('stop', 20),
           i_up2=ico('upload', 24, 'color:var(--blue)'), i_rf2=ico('up', 24, 'color:var(--blue)'), i_msg=ico('msg', 24, 'color:var(--blue)'), i_x=ico('shield', 24, 'color:var(--blue)'),
           c1=SHOTS['home'][2][2] / SHOTS['home'][2][3], c2=SHOTS['diagnose'][2][2] / SHOTS['diagnose'][2][3], c3=SHOTS['analyst'][2][2] / SHOTS['analyst'][2][3] + SHOTS['reply'][2][2] / SHOTS['reply'][2][3] + 0.04,
           g1=gcard(1, 'Home: pace vs the line', shot('home')),
           g2=gcard(2, 'Diagnose: a call per campaign', shot('diagnose')),
           g3=gcard(3, 'Analyst: question to answer', '<div style="display:grid;grid-template-columns:%.3ffr %.3ffr;gap:10px;align-items:start">%s%s</div>' % (SHOTS['analyst'][2][2] / SHOTS['analyst'][2][3], SHOTS['reply'][2][2] / SHOTS['reply'][2][3], shot('analyst'), shot('reply'))))


def build():
    html = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>RISA Growth APM, Vedant Vikas Shelkar</title>'
            '<style>' + CSS + '</style></head><body>' + S1 + S2 + S3 + FIT + '</body></html>')
    open(os.path.join(HERE, 'deck.html'), 'w', encoding='utf8').write(html)
    print('deck.html written', len(html) // 1024, 'KB')


if __name__ == '__main__':
    build()
