/**
 * PowerPoint นำเสนอผู้บริหาร / ลูกค้า — สร้างในเบราว์เซอร์จากข้อมูลชุดเดียวกับหน้า Dashboard
 *
 * แยกเป็น 2 ชั้น:
 *  - LsDeck.buildModel(): ประกอบ "โครงสไลด์" เป็นข้อมูลล้วน (ไม่แตะ PptxGenJS) — เทสต์ได้ใน Node
 *  - LsDeck.render():     วาดโครงนั้นเป็นไฟล์ .pptx ด้วย PptxGenJS (โหลดตอนกดปุ่มเท่านั้น)
 * กราฟเป็นกราฟจริงของ PowerPoint แก้ต่อได้
 */
(function (root) {
  'use strict';

  // ไฟล์ในเว็บเองก่อน (บางเครือข่ายบล็อก CDN) แล้วค่อยลอง CDN เวอร์ชันเดียวกัน
  var LIB_URLS = [
    '../vendor/pptxgen.bundle.js',
    'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
    'https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
  ];

  var EN = {
    'รายงานสรุปการผลิต H1 Lug&Screw': 'H1 Lug&Screw Production Summary',
    'ช่วงข้อมูล: {r}': 'Data period: {r}',
    'ตัวกรอง: {f}': 'Filters: {f}',
    'ข้อมูล ณ {t}': 'Generated {t}',
    'ภาพรวม': 'Overview',
    'ยอดผลิต (FG)': 'Output (FG)',
    'แผนผลิต': 'Plan',
    'ผลิตได้ตามแผน': 'Plan achievement',
    '% OEE': 'OEE %',
    '% NG (พาร์ท)': 'NG % (parts)',
    'งานเสีย (ชิ้น)': 'NG (pcs)',
    'ใบแจ้งซ่อมค้าง': 'Open repair tickets',
    'รายการบันทึก': 'Production entries',
    'ยอดคัดแยก': 'Sorting workload',
    'ยอดผลิตเทียบแผน': 'Output vs plan',
    'ยอดผลิตเทียบแผน ({g})': 'Output vs plan ({g})',
    'FG / NG รายเดือน': 'Monthly FG / NG',
    'แกนซ้าย = จำนวนชิ้น · แกนขวา = % NG (นับต่อพาร์ท Lug/Screw แบบเดียวกับ Dashboard)': 'Left axis = pieces · Right axis = NG % (per part Lug/Screw, same as Dashboard)',
    'ชิ้น': 'pcs',
    'เดือน': 'Month',
    'รายวัน': 'daily',
    'รายเดือน': 'monthly',
    'ผลิตจริง': 'Actual',
    'วันที่ / เดือน': 'Period',
    'ยอดผลิตแยกเครื่องจักร': 'Output by machine',
    'เครื่องจักร': 'Machine',
    'ผลิตจริง (FG)': 'Actual (FG)',
    'NG (ชิ้น)': 'NG (pcs)',
    '% NG': 'NG %',
    'OEE %': 'OEE %',
    'ยอดผลิตแยกรุ่นสินค้า': 'Output by product',
    'รุ่นสินค้า': 'Product',
    '{n} รุ่นแรกตามยอดผลิต': 'Top {n} products by output',
    'แยกตามกะ': 'By shift',
    'กะ': 'Shift',
    'กะ {s}': 'Shift {s}',
    'สาเหตุ NG สูงสุด': 'Top NG causes',
    'สาเหตุ': 'Cause',
    'จำนวน (ชิ้น)': 'Qty (pcs)',
    '% ของ NG ทั้งหมด': '% of all NG',
    'ไม่มีงานเสียในช่วงนี้': 'No NG recorded in this period',
    'งานซ่อมบำรุง': 'Maintenance',
    'ใบแจ้งซ่อมทั้งหมด': 'Repair tickets',
    'เวลาเครื่องหยุด (ชม.)': 'Downtime (hrs)',
    'ยังไม่ปิด': 'Still open',
    'ซ่อมเสร็จ': 'Completed',
    'ประเภทปัญหา': 'Issue type',
    'จำนวนใบ': 'Tickets',
    'งานซ่อมที่ยังค้าง': 'Open repair work',
    'วันที่': 'Date',
    'อาการ': 'Description',
    'สถานะ': 'Status',
    'ไม่มีงานซ่อมค้าง': 'No open repair work',
    'งานคัดแยก (Sorting)': 'Sorting',
    'จำนวนงาน': 'Jobs',
    'คัดแล้ว': 'Sorted',
    '% งานดี': 'Good %',
    '% NG คัดแยก': 'Sorting NG %',
    'งานค้าง (รอ/กำลังคัด)': 'Pending / in progress',
    'NG Lug / Screw / ทั้งคู่': 'NG Lug / Screw / both',
    'ยอดคัดแยกรวม ({g})': 'Total sorting workload ({g})',
    'ยอดคัดแยกรวม (ชิ้น)': 'Total sorting workload (pcs)',
    'รวมงานดี + งานเสีย + งานที่ยังรอคัด': 'Good + NG + work still waiting to be sorted',
    'ยอดคัดแยกแยกเครื่องจักร': 'Sorting by machine',
    'ยอดคัดรวม': 'Workload',
    'ไม่มีงานคัดแยกในช่วงนี้': 'No sorting jobs in this period',
    'ขอบคุณ': 'Thank you',
    'ตัวเลขทุกหน้ามาจากระบบ H1 Lug&Screw ชุดเดียวกับหน้า Dashboard': 'All figures come from the H1 Lug&Screw system — the same data as the Dashboard',
    'รวม': 'Total',
    'ทุกกะ': 'all shifts',
    'ทุกรุ่น': 'all products',
    'ทุก Job Order': 'all job orders'
  };

  var state = { lang: 'th' };

  function T(th, vars) {
    var s = state.lang === 'en' && EN[th] ? EN[th] : th;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(v) { return Math.round(num(v)).toLocaleString('en-US'); }
  function pct(a, b) { return b > 0 ? (a / b * 100) : 0; }
  function pctText(v) { return num(v).toFixed(1) + '%'; }

  // ช่วงยาวเกิน 2 เดือน → รวมเป็นรายเดือน ไม่งั้นกราฟแน่นจนอ่านไม่ออก
  function groupMode(from, to) {
    var a = new Date(String(from) + 'T00:00:00'), b = new Date(String(to) + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return 'day';
    return (b - a) / 86400000 + 1 > 62 ? 'month' : 'day';
  }
  function periodKey(date, mode) { var d = String(date || ''); return mode === 'month' ? d.slice(0, 7) : d.slice(0, 10); }
  function periodLabel(key, mode) {
    var m = String(key).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!m) return String(key);
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
    if (state.lang !== 'en') mon = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][Number(m[2]) - 1];
    return mode === 'month' ? mon + ' ' + m[1].slice(2) : Number(m[3]) + ' ' + mon;
  }
  // ทุกช่วงตั้งแต่ from ถึง to (ช่วงที่ไม่มีข้อมูลก็แสดงเป็น 0 ไม่ข้าม)
  function periodKeys(from, to, mode) {
    var keys = [];
    var a = new Date(String(from) + 'T00:00:00'), b = new Date(String(to) + 'T00:00:00');
    if (isNaN(a) || isNaN(b) || a > b) return keys;
    if (mode === 'month') a = new Date(a.getFullYear(), a.getMonth(), 1);
    for (var guard = 0; a <= b && guard < 800; guard += 1) {
      var y = a.getFullYear(), mo = ('0' + (a.getMonth() + 1)).slice(-2), d = ('0' + a.getDate()).slice(-2);
      keys.push(mode === 'month' ? y + '-' + mo : y + '-' + mo + '-' + d);
      a = mode === 'month' ? new Date(y, a.getMonth() + 1, 1) : new Date(y, a.getMonth(), a.getDate() + 1);
    }
    return keys;
  }
  function rangeText(r) {
    if (!r || !r.from) return '-';
    return r.from === r.to ? r.from : r.from + ' – ' + r.to;
  }
  // % NG ต่อพาร์ท สูตรเดียวกับ partNgRate ในหน้า Dashboard: ชุดดี 1 ชุด = Lug 1 + Screw 1
  function partNgRate(good, lugNg, screwNg) {
    var g = num(good), l = num(lugNg), sc = num(screwNg);
    var d = l + sc + 2 * g;
    return d > 0 ? (l + sc) / d * 100 : 0;
  }

  // NG ต่อพาร์ท (Lug/Screw) แบบเดียวกับหน้า Dashboard ถ้ามีฟังก์ชันของหน้า; ไม่มีก็ใช้ NG / (FG + NG)
  function ngRateOf(group, helpers) {
    if (helpers && typeof helpers.partNgRateOfGroup === 'function') {
      var r = Number(helpers.partNgRateOfGroup(group));
      if (isFinite(r)) return r;
    }
    return pct(num(group.defect), num(group.actual) + num(group.defect));
  }

  /**
   * D = ผลจาก getDashboardData (ตัวที่หน้า Dashboard โหลดอยู่)
   * S = { dash: getSortingDashboard, jobs: getSortingJobs } หรือ null ถ้าไม่เอา Sorting
   * opts = { lang, filters: { shiftAB, shiftDN, product, jobOrder }, now, helpers: { overallOEE, partNgRateOfGroup } }
   */
  function buildModel(D, S, opts) {
    opts = opts || {};
    state.lang = opts.lang === 'en' ? 'en' : 'th';
    var helpers = opts.helpers || {};
    var now = opts.now || new Date();
    var range = (D && D.dateRange) || {};
    var kpi = (D && D.kpi) || {};
    var mode = groupMode(range.from, range.to);
    var gLabel = T(mode === 'month' ? 'รายเดือน' : 'รายวัน');
    var slides = [];

    var f = opts.filters || {};
    var filterBits = [];
    if (f.shiftAB && f.shiftAB !== 'all') filterBits.push(T('กะ {s}', { s: f.shiftAB }));
    if (f.shiftDN && f.shiftDN !== 'all') filterBits.push(f.shiftDN === 'day' ? 'Day' : 'Night');
    if (f.product && f.product !== 'all') filterBits.push(f.product);
    if (f.jobOrder && f.jobOrder !== 'all') filterBits.push('JO ' + f.jobOrder);
    var stamp = now.toLocaleString(state.lang === 'en' ? 'en-GB' : 'th-TH');

    slides.push({
      kind: 'cover',
      title: T('รายงานสรุปการผลิต H1 Lug&Screw'),
      meta: [T('ช่วงข้อมูล: {r}', { r: rangeText(range) })]
        .concat(filterBits.length ? [T('ตัวกรอง: {f}', { f: filterBits.join(' · ') })] : [])
        .concat([T('ข้อมูล ณ {t}', { t: stamp })])
    });

    // ── ภาพรวม ──
    var pn = D && D.partNg;
    var ngRate = (pn && num(pn.partsUsed) > 0) ? num(pn.rate) : num(kpi.defectRate);
    var oee = typeof helpers.overallOEE === 'function' ? num(helpers.overallOEE(D.byMachine || {})) : num(kpi.achievementRate);
    var cards = [
      { label: T('ยอดผลิต (FG)'), value: fmt(kpi.totalOutput), tone: 'primary' },
      { label: T('แผนผลิต'), value: fmt(kpi.totalPlanned) },
      { label: T('ผลิตได้ตามแผน'), value: pctText(pct(num(kpi.totalOutput), num(kpi.totalPlanned))) },
      { label: T('% OEE'), value: pctText(oee), tone: 'good' },
      { label: T('% NG (พาร์ท)'), value: pctText(ngRate), tone: 'bad', sub: (pn && num(pn.partsUsed) > 0) ? 'Lug ' + pn.lugRate + '% · Screw ' + pn.screwRate + '%' : '' },
      { label: T('งานเสีย (ชิ้น)'), value: fmt(kpi.totalDefect), tone: 'bad' },
      { label: T('ใบแจ้งซ่อมค้าง'), value: fmt(kpi.openTickets), tone: num(kpi.openTickets) > 0 ? 'warn' : '' },
      { label: T('รายการบันทึก'), value: fmt(kpi.totalEntries) }
    ];
    if (S && S.dash && S.dash.summary) cards.push({ label: T('ยอดคัดแยก'), value: fmt(S.dash.summary.totalQty) });
    slides.push({ kind: 'kpis', title: T('ภาพรวม'), sub: T('ช่วงข้อมูล: {r}', { r: rangeText(range) }), cards: cards });

    // ── ยอดผลิตเทียบแผน ──
    var trend = (D && D.dailyTrend) || {};
    var pKeys = periodKeys(range.from, range.to, mode);
    var act = {}, plan = {};
    Object.keys(trend).forEach(function (d) {
      var k = periodKey(d, mode);
      act[k] = (act[k] || 0) + num(trend[d].actual);
      plan[k] = (plan[k] || 0) + num(trend[d].planned);
    });
    if (pKeys.length) {
      slides.push({
        kind: 'combo',
        title: T('ยอดผลิตเทียบแผน ({g})', { g: gLabel }),
        sub: T('ช่วงข้อมูล: {r}', { r: rangeText(range) }),
        labels: pKeys.map(function (k) { return periodLabel(k, mode); }),
        bars: [{ name: T('ผลิตจริง'), values: pKeys.map(function (k) { return act[k] || 0; }) }],
        line: { name: T('แผนผลิต'), values: pKeys.map(function (k) { return plan[k] || 0; }) }
      });
    }

    // ── FG / NG รายเดือน (กราฟ 2 แกน: ชิ้น ซ้าย, % NG ขวา) ──
    var mPeriods = periodKeys(range.from, range.to, 'month');
    var mAgg = {};
    Object.keys(trend).forEach(function (d) {
      var k = periodKey(d, 'month');
      if (!mAgg[k]) mAgg[k] = { fg: 0, ng: 0, lug: 0, screw: 0 };
      mAgg[k].fg += num(trend[d].actual);
      mAgg[k].ng += num(trend[d].defect);
      mAgg[k].lug += num(trend[d].lugNg);
      mAgg[k].screw += num(trend[d].screwNg);
    });
    var mRows = mPeriods.map(function (k) {
      var a = mAgg[k] || { fg: 0, ng: 0, lug: 0, screw: 0 };
      // ข้อมูลเก่าที่ไม่มีแยก Lug/Screw → ใช้ NG / (FG + NG)
      var rate = (a.lug + a.screw) > 0 || a.ng === 0 ? partNgRate(a.fg, a.lug, a.screw) : pct(a.ng, a.fg + a.ng);
      return { key: k, fg: a.fg, ng: a.ng, rate: Math.round(rate * 100) / 100 };
    });
    if (mRows.some(function (r) { return r.fg > 0 || r.ng > 0; })) {
      slides.push({
        kind: 'dualAxis',
        title: T('FG / NG รายเดือน'),
        sub: T('ช่วงข้อมูล: {r}', { r: rangeText(range) }) + ' · ' + T('แกนซ้าย = จำนวนชิ้น · แกนขวา = % NG (นับต่อพาร์ท Lug/Screw แบบเดียวกับ Dashboard)'),
        labels: mRows.map(function (r) { return periodLabel(r.key, 'month'); }),
        bars: [
          { name: 'FG', values: mRows.map(function (r) { return r.fg; }) },
          { name: 'NG', values: mRows.map(function (r) { return r.ng; }) }
        ],
        line: { name: '% NG', values: mRows.map(function (r) { return r.rate; }) },
        leftTitle: T('ชิ้น'),
        rightTitle: '% NG',
        table: mRows.length <= 12 ? {
          headers: [T('เดือน')].concat(mRows.map(function (r) { return periodLabel(r.key, 'month'); })),
          rows: [
            ['FG'].concat(mRows.map(function (r) { return fmt(r.fg); })),
            ['NG'].concat(mRows.map(function (r) { return fmt(r.ng); })),
            ['% NG'].concat(mRows.map(function (r) { return r.rate.toFixed(2) + '%'; }))
          ],
          numeric: [false].concat(mRows.map(function () { return true; }))
        } : null
      });
    }

    // ── แยกเครื่องจักร ──
    var bm = (D && D.byMachine) || {};
    var mKeys = Object.keys(bm).sort();
    if (mKeys.length) {
      slides.push({
        kind: 'chartTable',
        title: T('ยอดผลิตแยกเครื่องจักร'),
        sub: T('ช่วงข้อมูล: {r}', { r: rangeText(range) }),
        chart: { labels: mKeys, series: [
          { name: T('ผลิตจริง (FG)'), values: mKeys.map(function (k) { return num(bm[k].actual); }) },
          { name: T('แผนผลิต'), values: mKeys.map(function (k) { return num(bm[k].planned); }) }
        ] },
        table: {
          headers: [T('เครื่องจักร'), T('แผนผลิต'), T('ผลิตจริง (FG)'), T('NG (ชิ้น)'), T('% NG'), T('OEE %')],
          rows: mKeys.map(function (k) {
            var m = bm[k];
            return [k, fmt(m.planned), fmt(m.actual), fmt(m.defect), pctText(ngRateOf(m, helpers)), pctText(m.oeeRate)];
          }),
          numeric: [false, true, true, true, true, true]
        }
      });
    }

    // ── แยกรุ่นสินค้า ──
    var bp = (D && D.byProduct) || {};
    var pList = Object.keys(bp).map(function (k) { return { code: k, p: bp[k] }; })
      .filter(function (x) { return num(x.p.actual) > 0 || num(x.p.defect) > 0; })
      .sort(function (a, b) { return num(b.p.actual) - num(a.p.actual); });
    if (pList.length) {
      var topP = pList.slice(0, 12);
      slides.push({
        kind: 'table',
        title: T('ยอดผลิตแยกรุ่นสินค้า'),
        sub: T('{n} รุ่นแรกตามยอดผลิต', { n: topP.length }) + ' · ' + T('ช่วงข้อมูล: {r}', { r: rangeText(range) }),
        table: {
          headers: [T('รุ่นสินค้า'), T('แผนผลิต'), T('ผลิตจริง (FG)'), T('NG (ชิ้น)'), T('% NG')],
          rows: topP.map(function (x) { return [x.code, fmt(x.p.planned), fmt(x.p.actual), fmt(x.p.defect), pctText(ngRateOf(x.p, helpers))]; }),
          numeric: [false, true, true, true, true]
        }
      });
    }

    // ── แยกกะ + สาเหตุ NG ──
    var bs = (D && D.byShift) || {};
    var sKeys = Object.keys(bs).filter(function (k) { return num(bs[k].actual) > 0 || num(bs[k].defect) > 0; }).sort();
    var ng = (D && D.ngByReason) || {};
    var ngList = Object.keys(ng).map(function (k) { return { reason: k, qty: num(ng[k]) }; })
      .filter(function (x) { return x.qty > 0; })
      .sort(function (a, b) { return b.qty - a.qty; });
    var ngSum = ngList.reduce(function (a, x) { return a + x.qty; }, 0);
    var topNg = ngList.slice(0, 10);
    slides.push({
      kind: 'ng',
      title: T('สาเหตุ NG สูงสุด'),
      sub: T('ช่วงข้อมูล: {r}', { r: rangeText(range) }),
      empty: topNg.length ? '' : T('ไม่มีงานเสียในช่วงนี้'),
      chart: topNg.length ? { labels: topNg.map(function (x) { return x.reason; }), series: [{ name: T('จำนวน (ชิ้น)'), values: topNg.map(function (x) { return x.qty; }) }] } : null,
      table: sKeys.length ? {
        headers: [T('กะ'), T('ผลิตจริง (FG)'), T('NG (ชิ้น)'), T('% NG')],
        rows: sKeys.map(function (k) { var s = bs[k]; return [T('กะ {s}', { s: k }), fmt(s.actual), fmt(s.defect), pctText(ngRateOf(s, helpers))]; }),
        numeric: [false, true, true, true],
        caption: T('แยกตามกะ')
      } : null,
      ngTable: topNg.length ? {
        headers: [T('สาเหตุ'), T('จำนวน (ชิ้น)'), T('% ของ NG ทั้งหมด')],
        rows: topNg.map(function (x) { return [x.reason, fmt(x.qty), pctText(pct(x.qty, ngSum))]; }),
        numeric: [false, true, true]
      } : null
    });

    // ── ซ่อมบำรุง ──
    var mt = (D && D.maintenance) || null;
    if (mt) {
      var types = Object.keys(mt.byType || {}).map(function (k) { return { t: k || '-', n: num(mt.byType[k]) }; })
        .sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
      var open = (mt.unresolvedTickets || []).slice(0, 8);
      slides.push({
        kind: 'maint',
        title: T('งานซ่อมบำรุง'),
        sub: T('ช่วงข้อมูล: {r}', { r: rangeText(range) }),
        cards: [
          { label: T('ใบแจ้งซ่อมทั้งหมด'), value: fmt(mt.totalShownTickets != null ? mt.totalShownTickets : mt.totalTickets) },
          { label: T('เวลาเครื่องหยุด (ชม.)'), value: (num(mt.totalDowntime) / 60).toFixed(1) },
          { label: T('ยังไม่ปิด'), value: fmt(mt.unresolvedTicketCount), tone: num(mt.unresolvedTicketCount) > 0 ? 'warn' : '' },
          { label: T('ซ่อมเสร็จ'), value: fmt(mt.completedTicketCount), tone: 'good' }
        ],
        chart: types.length ? { labels: types.map(function (x) { return x.t; }), series: [{ name: T('จำนวนใบ'), values: types.map(function (x) { return x.n; }) }] } : null,
        table: {
          caption: T('งานซ่อมที่ยังค้าง'),
          headers: [T('วันที่'), T('เครื่องจักร'), T('อาการ'), T('สถานะ')],
          rows: open.map(function (t) { return [String(t.date || '').slice(0, 10), String(t.machineId || '-'), String(t.description || t.issueType || '-'), String(t.status || '-')]; }),
          numeric: [false, false, false, false],
          empty: T('ไม่มีงานซ่อมค้าง')
        }
      });
    }

    // ── Sorting ──
    if (S) {
      var sum = (S.dash && S.dash.summary) || {};
      var jobs = S.jobs || [];
      var sortTotals = {};
      jobs.forEach(function (j) {
        var k = periodKey(j.Date, mode);
        if (!k) return;
        sortTotals[k] = (sortTotals[k] || 0) + num(j.TotalQty);
      });
      var hasSorting = num(sum.totalJobs) > 0 || jobs.length > 0;
      slides.push({
        kind: 'kpis',
        title: T('งานคัดแยก (Sorting)'),
        sub: T('ช่วงข้อมูล: {r}', { r: rangeText(range) }),
        empty: hasSorting ? '' : T('ไม่มีงานคัดแยกในช่วงนี้'),
        cards: hasSorting ? [
          { label: T('จำนวนงาน'), value: fmt(sum.totalJobs) },
          { label: T('ยอดคัดแยกรวม (ชิ้น)'), value: fmt(sum.totalQty), tone: 'primary' },
          { label: T('คัดแล้ว'), value: fmt(sum.totalSorted) },
          { label: T('% งานดี'), value: pctText(sum.goodRate), tone: 'good' },
          { label: T('% NG คัดแยก'), value: pctText(sum.defectRate), tone: 'bad', sub: 'Lug ' + num(sum.lugRate).toFixed(2) + '% · Screw ' + num(sum.screwRate).toFixed(2) + '%' },
          { label: T('NG Lug / Screw / ทั้งคู่'), value: fmt(sum.defectLug) + ' / ' + fmt(sum.defectScrew) + ' / ' + fmt(sum.defectScrewLug) },
          { label: T('งานค้าง (รอ/กำลังคัด)'), value: fmt(num(sum.pendingJobs) + num(sum.inProgressJobs)), tone: (num(sum.pendingJobs) + num(sum.inProgressJobs)) > 0 ? 'warn' : '' }
        ] : []
      });
      if (hasSorting && pKeys.length) {
        // ผู้ใช้ขอ: ไม่แยกงานดี/งานเสีย — แท่งเดียวเป็นยอดรวมต่อช่วง พร้อมตัวเลขบนหัวแท่ง
        slides.push({
          kind: 'bar',
          title: T('ยอดคัดแยกรวม ({g})', { g: gLabel }),
          sub: T('ช่วงข้อมูล: {r}', { r: rangeText(range) }) + ' · ' + T('รวมงานดี + งานเสีย + งานที่ยังรอคัด'),
          labels: pKeys.map(function (k) { return periodLabel(k, mode); }),
          series: [{ name: T('ยอดคัดแยกรวม (ชิ้น)'), values: pKeys.map(function (k) { return sortTotals[k] || 0; }) }],
          dataLabels: pKeys.length <= 31
        });
      }
      var sbm = (S.dash && S.dash.byMachine) || {};
      var smKeys = Object.keys(sbm).sort();
      if (hasSorting && smKeys.length) {
        slides.push({
          kind: 'table',
          title: T('ยอดคัดแยกแยกเครื่องจักร'),
          sub: T('ช่วงข้อมูล: {r}', { r: rangeText(range) }),
          table: {
            headers: [T('เครื่องจักร'), T('จำนวนงาน'), T('ยอดคัดรวม'), T('คัดแล้ว'), T('NG (ชิ้น)'), T('% งานดี')],
            rows: smKeys.map(function (k) {
              var m = sbm[k];
              var sorted = num(m.good) + num(m.defect);
              return [k, fmt(m.jobs), fmt(m.total), fmt(sorted), fmt(m.defect), pctText(pct(num(m.good), sorted))];
            }),
            numeric: [false, true, true, true, true, true]
          }
        });
      }
    }

    slides.push({ kind: 'closing', title: T('ขอบคุณ'), sub: T('ตัวเลขทุกหน้ามาจากระบบ H1 Lug&Screw ชุดเดียวกับหน้า Dashboard') });

    return {
      title: T('รายงานสรุปการผลิต H1 Lug&Screw'),
      footer: 'H1 Lug&Screw · ' + rangeText(range),
      lang: state.lang,
      fileName: 'H1-LugScrew-' + (range.from || '') + (range.to && range.to !== range.from ? '_' + range.to : '') + (state.lang === 'en' ? '-EN' : '') + '.pptx',
      slides: slides
    };
  }

  // ── วาดเป็น .pptx ─────────────────────────────────────────────────────
  var C = { ink: '0F172A', mut: '64748B', line: 'E2E8F0', primary: '1A73E8', good: '1E8E3E', bad: 'D93025', warn: 'E37400', soft: 'F8FAFC' };
  var TONE = { primary: C.primary, good: C.good, bad: C.bad, warn: C.warn };

  function render(PptxGenJS, model) {
    var pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 นิ้ว
    pptx.title = model.title;
    pptx.company = 'JR';
    var F = 'Tahoma'; // มีทั้งไทยและอังกฤษในทุก Windows/Office
    pptx.defineSlideMaster({
      title: 'LS_BODY',
      background: { color: 'FFFFFF' },
      objects: [
        { rect: { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: C.primary } } },
        { text: { text: model.footer, options: { x: 0.5, y: 7.05, w: 10, h: 0.3, fontFace: F, fontSize: 9, color: '94A3B8' } } }
      ],
      slideNumber: { x: 12.2, y: 7.05, w: 0.7, h: 0.3, fontFace: F, fontSize: 9, color: '94A3B8', align: 'right' }
    });

    function head(slide, s) {
      slide.addText(s.title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontFace: F, fontSize: 24, bold: true, color: C.ink });
      if (s.sub) slide.addText(s.sub, { x: 0.5, y: 0.88, w: 12.3, h: 0.4, fontFace: F, fontSize: 13, color: C.mut });
    }
    function emptyNote(slide, text, y) {
      slide.addText(text, { x: 0.5, y: y || 3.2, w: 12.3, h: 0.6, fontFace: F, fontSize: 16, color: C.mut, align: 'center' });
    }
    function cardsAt(slide, cards, y, perRow) {
      perRow = perRow || 4;
      var gap = 0.2, w = (12.3 - gap * (perRow - 1)) / perRow, h = 1.35;
      cards.forEach(function (c, i) {
        var x = 0.5 + (i % perRow) * (w + gap), yy = y + Math.floor(i / perRow) * (h + gap);
        slide.addShape(pptx.ShapeType.roundRect, { x: x, y: yy, w: w, h: h, fill: { color: C.soft }, line: { color: C.line }, rectRadius: 0.08 });
        var big = String(c.value).length > 9 ? 20 : 28;
        slide.addText(String(c.value), { x: x + 0.15, y: yy + 0.12, w: w - 0.3, h: 0.65, fontFace: F, fontSize: big, bold: true, color: TONE[c.tone] || C.ink });
        slide.addText(c.label, { x: x + 0.15, y: yy + 0.78, w: w - 0.3, h: 0.3, fontFace: F, fontSize: 12, color: C.mut });
        if (c.sub) slide.addText(c.sub, { x: x + 0.15, y: yy + 1.04, w: w - 0.3, h: 0.25, fontFace: F, fontSize: 10, color: C.mut });
      });
      return y + Math.ceil(cards.length / perRow) * (h + gap);
    }
    function table(slide, t, x, y, w, opt) {
      opt = opt || {};
      if (t.caption) { slide.addText(t.caption, { x: x, y: y, w: w, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: C.ink }); y += 0.4; }
      if (!t.rows.length) { slide.addText(t.empty || '-', { x: x, y: y, w: w, h: 0.4, fontFace: F, fontSize: 12, color: C.mut }); return; }
      var fs = opt.fontSize || 11;
      var rows = [t.headers.map(function (h, i) {
        return { text: h, options: { bold: true, color: 'FFFFFF', fill: { color: '1E293B' }, align: t.numeric[i] ? 'right' : 'left' } };
      })];
      t.rows.forEach(function (r, ri) {
        rows.push(r.map(function (v, i) {
          return { text: String(v), options: { align: t.numeric[i] ? 'right' : 'left', fill: { color: ri % 2 ? 'F8FAFC' : 'FFFFFF' } } };
        }));
      });
      slide.addTable(rows, { x: x, y: y, w: w, colW: opt.colW, fontFace: F, fontSize: fs, color: C.ink, border: { type: 'solid', pt: 0.5, color: C.line }, rowH: opt.rowH || 0.32, valign: 'middle', autoPage: false });
    }
    function barChart(slide, ch, box, o) {
      o = o || {};
      slide.addChart(pptx.charts.BAR, ch.series.map(function (s) { return { name: s.name, labels: ch.labels, values: s.values }; }), Object.assign({
        x: box.x, y: box.y, w: box.w, h: box.h,
        barDir: o.horizontal ? 'bar' : 'col',
        chartColors: o.colors || [C.primary, 'A0AEC0'],
        catAxisLabelFontFace: F, catAxisLabelFontSize: 10, valAxisLabelFontFace: F, valAxisLabelFontSize: 10,
        valAxisLabelFormatCode: '#,##0',
        valGridLine: { color: 'EEEEEE', size: 0.5 },
        showLegend: ch.series.length > 1, legendPos: 't', legendFontFace: F, legendFontSize: 10,
        showValue: !!o.showValue, dataLabelFormatCode: '#,##0', dataLabelFontFace: F, dataLabelFontSize: 9, dataLabelPosition: 'outEnd'
      }, o.extra || {}));
    }

    model.slides.forEach(function (s) {
      if (s.kind === 'cover') {
        var c = pptx.addSlide();
        c.background = { color: '0F172A' };
        c.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: C.primary } });
        c.addText(s.title, { x: 0.9, y: 2.2, w: 11.5, h: 1.2, fontFace: F, fontSize: 36, bold: true, color: 'FFFFFF' });
        c.addText(s.meta.join('\n'), { x: 0.9, y: 3.6, w: 11.5, h: 1.6, fontFace: F, fontSize: 16, color: 'CBD5E1', valign: 'top', paraSpaceAfter: 6 });
        return;
      }
      if (s.kind === 'closing') {
        var e = pptx.addSlide();
        e.background = { color: '0F172A' };
        e.addText(s.title, { x: 0.5, y: 2.6, w: 12.3, h: 1, fontFace: F, fontSize: 40, bold: true, color: 'FFFFFF', align: 'center' });
        e.addText(s.sub, { x: 0.5, y: 3.7, w: 12.3, h: 0.6, fontFace: F, fontSize: 14, color: 'CBD5E1', align: 'center' });
        return;
      }
      var slide = pptx.addSlide({ masterName: 'LS_BODY' });
      head(slide, s);
      if (s.kind === 'kpis') {
        if (s.empty) { emptyNote(slide, s.empty); return; }
        cardsAt(slide, s.cards, 1.6, 4);
      } else if (s.kind === 'combo') {
        slide.addChart([
          { type: pptx.charts.BAR, data: s.bars.map(function (b) { return { name: b.name, labels: s.labels, values: b.values }; }), options: { chartColors: [C.good], barGapWidthPct: 40 } },
          { type: pptx.charts.LINE, data: [{ name: s.line.name, labels: s.labels, values: s.line.values }], options: { chartColors: [C.warn], lineSize: 2, lineDataSymbol: 'none' } }
        ], {
          x: 0.5, y: 1.4, w: 12.3, h: 5.5,
          catAxisLabelFontFace: F, catAxisLabelFontSize: s.labels.length > 20 ? 8 : 10, valAxisLabelFontFace: F, valAxisLabelFontSize: 10,
          valAxisLabelFormatCode: '#,##0', valGridLine: { color: 'EEEEEE', size: 0.5 },
          showLegend: true, legendPos: 't', legendFontFace: F, legendFontSize: 11
        });
      } else if (s.kind === 'dualAxis') {
        var chartH = s.table ? 4.0 : 5.5;
        slide.addChart([
          { type: pptx.charts.BAR, data: s.bars.map(function (b) { return { name: b.name, labels: s.labels, values: b.values }; }),
            options: { chartColors: [C.good, C.bad], barGrouping: 'stacked', barGapWidthPct: 50 /* FG + NG ซ้อนเป็นแท่งเดียว = ยอดรวมที่ผลิตออกมา */ } },
          { type: pptx.charts.LINE, data: [{ name: s.line.name, labels: s.labels, values: s.line.values }],
            options: { chartColors: [C.warn], lineSize: 2.5, lineDataSymbol: 'circle', lineDataSymbolSize: 7,
              secondaryValAxis: true, secondaryCatAxis: true,
              showValue: s.labels.length <= 12, dataLabelFormatCode: '0.00"%"', dataLabelPosition: 't', dataLabelFontFace: F, dataLabelFontSize: 9, dataLabelColor: C.warn } }
        ], {
          x: 0.5, y: 1.4, w: 12.3, h: chartH,
          catAxisLabelFontFace: F, catAxisLabelFontSize: 10,
          valAxes: [
            { showValAxisTitle: true, valAxisTitle: s.leftTitle, valAxisTitleFontFace: F, valAxisTitleFontSize: 10, valAxisLabelFontFace: F, valAxisLabelFontSize: 10, valAxisLabelFormatCode: '#,##0', valGridLine: { color: 'EEEEEE', size: 0.5 } },
            { showValAxisTitle: true, valAxisTitle: s.rightTitle, valAxisTitleFontFace: F, valAxisTitleFontSize: 10, valAxisLabelFontFace: F, valAxisLabelFontSize: 10, valAxisLabelFormatCode: '0.0"%"', valAxisMinVal: 0, valGridLine: { style: 'none' } }
          ],
          catAxes: [{ catAxisTitle: '' }, { catAxisHidden: true }],
          showLegend: true, legendPos: 't', legendFontFace: F, legendFontSize: 11
        });
        if (s.table) table(slide, s.table, 0.5, 1.5 + chartH, 12.3, { fontSize: 10, rowH: 0.28 });
      } else if (s.kind === 'bar') {
        barChart(slide, { labels: s.labels, series: s.series }, { x: 0.5, y: 1.4, w: 12.3, h: 5.5 }, { showValue: s.dataLabels, colors: [C.primary] });
      } else if (s.kind === 'chartTable') {
        barChart(slide, s.chart, { x: 0.5, y: 1.4, w: 6.4, h: 5.4 }, { colors: [C.good, 'A0AEC0'] });
        table(slide, s.table, 7.1, 1.5, 5.7, { fontSize: s.table.rows.length > 12 ? 9 : 10.5, rowH: s.table.rows.length > 12 ? 0.27 : 0.32 });
      } else if (s.kind === 'table') {
        table(slide, s.table, 0.5, 1.5, 12.3, { fontSize: 12, rowH: 0.36 });
      } else if (s.kind === 'ng') {
        if (s.empty) emptyNote(slide, s.empty, 2.4);
        else {
          barChart(slide, s.chart, { x: 0.5, y: 1.4, w: 6.6, h: 5.5 }, { horizontal: true, showValue: true, colors: [C.bad], extra: { catAxisOrientation: 'maxMin' } });
          table(slide, s.ngTable, 7.3, 1.5, 5.5, { fontSize: 10, rowH: 0.3 });
        }
        if (s.table) table(slide, s.table, s.empty ? 3.6 : 7.3, s.empty ? 3.4 : 5.2, s.empty ? 6 : 5.5, { fontSize: 10, rowH: 0.28 });
      } else if (s.kind === 'maint') {
        var y2 = cardsAt(slide, s.cards, 1.45, 4);
        if (s.chart) barChart(slide, s.chart, { x: 0.5, y: y2, w: 5.4, h: 6.9 - y2 }, { horizontal: true, showValue: true, colors: [C.warn], extra: { catAxisOrientation: 'maxMin' } });
        table(slide, s.table, s.chart ? 6.1 : 0.5, y2, s.chart ? 6.7 : 12.3, { fontSize: 10, rowH: 0.3, colW: s.chart ? [1.0, 1.0, 3.5, 1.2] : undefined });
      }
    });
    return pptx;
  }

  var libPromise = null;
  function loadLib() {
    if (root.PptxGenJS) return Promise.resolve(root.PptxGenJS);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      var i = 0;
      (function next() {
        if (i >= LIB_URLS.length) { libPromise = null; reject(new Error('โหลดตัวสร้าง PowerPoint ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')); return; }
        var s = document.createElement('script');
        s.src = LIB_URLS[i++];
        s.onload = function () { root.PptxGenJS ? resolve(root.PptxGenJS) : next(); };
        s.onerror = next;
        document.head.appendChild(s);
      })();
    });
    return libPromise;
  }

  var api = { buildModel: buildModel, render: render, loadLib: loadLib, LIB_URLS: LIB_URLS, _periodKeys: periodKeys, _groupMode: groupMode };
  root.LsDeck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
