/**
 * ChartTools — เครื่องมือเสริมกราฟ Chart.js (ใช้ซ้ำได้ทุกกราฟ)
 *  - initChartDrawTool(chart, key)   แถบเครื่องมือตีเส้นบนกราฟ (เส้นแนวโน้ม / แนวนอน / วัดช่วง / คาบซ้ำ / เลือก-แก้ / ยางลบ)
 *  - periodSwitcher(el, opts)        ปุ่ม [วัน | สัปดาห์ | เดือน | ไตรมาส | ปี] + "ทุกกราฟ"
 *  - aggregate(rows, period, opt)    รวมข้อมูลรายวันเป็นช่วง (ค่าอัตราคำนวณจากผลรวม)
 *  - valuesToggle(el, opts) / setValueMode(chart, on)   ตัวเลขบนจุด (datalabels) หรือ crosshair
 *  - buildProjection(agg, period, specs, opts)          เส้น Projection + ช่วงคาดการณ์ 95% ตามช่วงที่เลือก
 *  - zoomOptions / zoomReset / syncZoom                 ซูม-เลื่อนกราฟ (chartjs-plugin-zoom) + ปุ่มรีเซ็ต
 *  - expandButton(el, card)                             ขยายการ์ดกราฟเต็มจอ
 * พิกัดเส้นที่วาดเก็บเป็นพิกัดข้อมูล (label แกน X + ค่าแกน Y) ใน localStorage (prefix h1ls_)
 * ต้องโหลดหลัง chart.js และ ui.js (UI.holtForecast / FORECAST_HORIZON / workdayElapsed / getToday)
 * ที่มา: tomtops43-png/Assembly-M-C-Management docs/js/chart-tools.js (ปรับให้ใช้กับไลน์ Lug & Screw)
 *
 * ค่าเสริมบนตัวกราฟ (นอกเหนือจาก $period / $projMeta / $fmtLabel / $fmtPoint / $axisFmt):
 *  - $valAxis      id แกนค่าหลักที่ใช้ตีเส้น (ค่าเริ่มต้น 'y' หรือ 'x' ถ้าเป็นกราฟแนวนอน)
 *  - $valAxes      id แกนค่าที่แสดงในป้ายเส้นระดับ (ค่าเริ่มต้น ['y', 'y1'])
 *  - $ownCrosshair true = กราฟมี crosshair ของตัวเองอยู่แล้ว (ปิดตัวเลขไม่ต้องเปิด crosshair ของ ChartTools)
 */
const ChartTools = (() => {
  const PREFIX = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.STORAGE_PREFIX) || 'h1ls_';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(PREFIX + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) { /* storage ปิด/เต็ม */ } }
  };
  const fmtNum = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  // ---------- ช่วงเวลา (id ของช่วง = วันแรกของช่วง YYYY-MM-DD) ----------
  const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const PERIODS = [['day', 'วัน'], ['week', 'สัปดาห์'], ['month', 'เดือน'], ['quarter', 'ไตรมาส'], ['year', 'ปี']];
  const HORIZON_KEY = { day: 'daily', week: 'weekly', month: 'monthly', quarter: 'quarterly', year: 'yearly' };
  const D = (s) => new Date(s + 'T00:00:00Z');
  const ymd = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

  function periodStart(date, p) {
    const d = D(date);
    if (p === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // เริ่มวันจันทร์
    else if (p === 'month') d.setUTCDate(1);
    else if (p === 'quarter') d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3, 1);
    else if (p === 'year') d.setUTCMonth(0, 1);
    return ymd(d);
  }
  function nextPeriod(id, p) {
    const d = D(id);
    if (p === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (p === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else if (p === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
    else if (p === 'quarter') d.setUTCMonth(d.getUTCMonth() + 3);
    else d.setUTCFullYear(d.getUTCFullYear() + 1);
    return ymd(d);
  }
  const periodEnd = (id, p) => addDays(nextPeriod(id, p), -1);
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // พฤหัสของสัปดาห์
    const y1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return { w: 1 + Math.round(((t - y1) / 864e5 - 3 + ((y1.getUTCDay() + 6) % 7)) / 7), y: t.getUTCFullYear() };
  }
  /** label แกน X: วัน "5 พ.ย." · สัปดาห์ "W45/26" · เดือน "พ.ย. 26" · ไตรมาส "Q4/26" · ปี "2026" */
  function periodLabel(id, p) {
    if (!id) return '';
    const d = D(id), m = d.getUTCMonth(), yy = String(d.getUTCFullYear()).slice(2);
    if (p === 'week') { const w = isoWeek(d); return `W${w.w}/${String(w.y).slice(2)}`; }
    if (p === 'month') return `${TH_MON[m]} ${yy}`;
    if (p === 'quarter') return `Q${Math.floor(m / 3) + 1}/${yy}`;
    if (p === 'year') return String(d.getUTCFullYear());
    return `${d.getUTCDate()} ${TH_MON[m]}`;
  }

  /**
   * รวมแถวรายวัน [{date, ...}] เป็นช่วง
   * opt.sum = ['actual', 'defect', ...] (บวกกัน) ; opt.rates = { name: (agg) => ค่า } (คำนวณจากผลรวม ห้ามเฉลี่ย % รายวัน)
   * opt.countIf(row) = นับวันนั้นเป็นวันทำงานไหม (ค่าเริ่มต้น นับทุกแถว) เช่น วันที่ไม่มียอดผลิตไม่นับ
   * ผลลัพธ์: [{ id, start, end, days (จำนวนวันที่มีข้อมูล), lastDate, ...sum, ...rates }]
   */
  function aggregate(rows, p, opt) {
    const map = new Map();
    rows.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((r) => {
      const id = periodStart(r.date, p);
      let a = map.get(id);
      if (!a) { a = { id, start: id, end: periodEnd(id, p), days: 0, lastDate: r.date }; opt.sum.forEach((f) => { a[f] = 0; }); map.set(id, a); }
      if (!opt.countIf || opt.countIf(r)) a.days++; // days = จำนวนวันทำงาน (ใช้หา "ยอดต่อวันทำงาน")
      a.lastDate = r.date;
      opt.sum.forEach((f) => { a[f] += Number(r[f]) || 0; });
    });
    const out = [...map.values()];
    out.forEach((a) => Object.keys(opt.rates || {}).forEach((k) => { a[k] = opt.rates[k](a); }));
    return out;
  }

  // ---------- Projection (Holt damped) ตามช่วงที่เลือก ----------
  /**
   * agg   = ผลจาก aggregate() ; dates = วันที่ทั้งหมดที่มีข้อมูล (ใช้หาวันทำงาน)
   * specs = [{ field, kind: 'total'|'rate', label, band, yAxisID, color, clampHi, decimals }]
   *   total → ทำนายเป็น "ยอดต่อวันทำงาน" แล้วคูณจำนวนวันทำงานของแต่ละช่วง
   *   rate  → ทำนายค่าอัตราตรง ๆ
   * ช่วงที่ยังไม่จบ (มีวันนี้อยู่) ไม่ป้อนให้โมเดล — ประเมินเป็น ยอดจริงถึงวันนี้ + (วันทำงานที่เหลือ × ค่าที่ทำนาย)
   * opt.complete = true → ถือว่าทุกช่วงจบแล้ว (ข้อมูลรายเดือนที่ปิดยอดแล้ว เช่น ต้นทุน)
   * spec.clampLo = ขอบล่าง (ค่าเริ่มต้น 0 ; ใส่ -Infinity สำหรับค่าที่ติดลบได้ เช่น กำไร)
   * คืน { ids (label ทั้งหมดรวมอนาคต), datasets, meta: { label → { anchor, rng, decimals } } }
   */
  function buildProjection(agg, p, specs, dates, opt) {
    opt = opt || {};
    const ids = agg.map((a) => a.id);
    const none = { ids, datasets: [], meta: {} };
    if (!agg.length || typeof UI === 'undefined' || !UI.holtForecast) return none;
    const today = UI.getToday(), el = UI.workdayElapsed();
    const last = agg[agg.length - 1];
    const partial = !opt.complete && today >= last.start && today <= last.end;
    const fit = partial ? agg.slice(0, -1) : agg;
    const H = UI.FORECAST_HORIZON[HORIZON_KEY[p]] || 1;
    if (fit.length < 4) return none;

    // วันทำงาน: ข้ามวันในสัปดาห์ที่ไม่เคยมีการผลิตเลย (เมื่อข้อมูลย้อนหลัง ≥ 14 วัน)
    const ds = (dates || []).slice().sort();
    const span = ds.length ? (Date.parse(ds[ds.length - 1]) - Date.parse(ds[0])) / 864e5 : 0;
    const dows = new Set(ds.map((d) => D(d).getUTCDay()));
    const isWork = (d) => span < 14 || dows.has(D(d).getUTCDay());
    const workDaysIn = (a, b) => { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (isWork(d)) n++; return n; };

    const steps = [];
    let cur = fit[fit.length - 1].id;
    if (partial) { steps.push(last.id); cur = last.id; }
    while (steps.length < H) {
      cur = nextPeriod(cur, p);
      if (p === 'day' && !isWork(cur)) continue;
      steps.push(cur);
    }
    steps.forEach((id) => { if (!ids.includes(id)) ids.push(id); });

    const L = ids.length, anchor = fit.length - 1, meta = {}, datasets = [];
    specs.forEach((s) => {
      const series = fit.map((a) => (s.kind === 'total' ? (a.days ? a[s.field] / a.days : NaN) : (a[s.field] === null || a[s.field] === undefined ? NaN : Number(a[s.field]))));
      const fc = UI.holtForecast(series, H);
      if (!fc) return;
      const hiCap = s.clampHi === undefined ? Infinity : s.clampHi, loCap = s.clampLo === undefined ? 0 : s.clampLo, dec = s.decimals || 0;
      const clamp = (v) => +Math.min(hiCap, Math.max(loCap, v)).toFixed(dec);
      const proj = new Array(L).fill(null), lo = new Array(L).fill(null), hi = new Array(L).fill(null), rng = {};
      const lastVal = Number(fit[anchor][s.field]) || 0;
      proj[anchor] = lo[anchor] = hi[anchor] = lastVal;
      steps.forEach((id, h) => {
        const idx = ids.indexOf(id), f = fc.forecast[h], w = 1.96 * fc.sd[h];
        let v = [f, f - w, f + w];
        const isPartial = partial && h === 0;
        // วันทำงานที่เหลือของช่วงนี้ (วันนี้นับเฉพาะส่วนที่ยังไม่ผ่าน)
        const rem = isPartial ? (isWork(today) ? 1 - el : 0) + (today < last.end ? workDaysIn(addDays(today, 1), last.end) : 0) : 0;
        if (s.kind === 'total') {
          const wd = isPartial ? rem : (p === 'day' ? 1 : workDaysIn(id, periodEnd(id, p)));
          const base = isPartial ? Number(last[s.field]) || 0 : 0;
          v = v.map((x) => base + wd * x);
        } else if (isPartial) {
          const done = last.days, wt = done / Math.max(1e-9, done + rem), now = Number(last[s.field]) || 0;
          v = v.map((x) => wt * now + (1 - wt) * x);
        }
        proj[idx] = clamp(v[0]); lo[idx] = clamp(v[1]); hi[idx] = clamp(v[2]);
        rng[idx] = [lo[idx], hi[idx]];
      });
      meta[s.label] = { anchor, rng, decimals: dec };
      const fillColor = s.color.replace(/[\d.]+\)$/, '.12)');
      // stack แยกทุกชุด — กราฟที่แกนค่าเป็น stacked (แท่งซ้อน) จะได้ไม่เอาเส้น Projection ไปบวกทับกัน
      const sk = '_pj' + datasets.length;
      datasets.push(
        { type: 'line', label: s.label, data: proj, borderColor: s.color, backgroundColor: s.color, borderWidth: 2, borderDash: [2, 4], pointStyle: 'rectRot', pointRadius: 4, spanGaps: true, fill: false, tension: 0, yAxisID: s.yAxisID, stack: sk + 'p', order: -1, _proj: true },
        { type: 'line', label: '_lo ' + s.label, data: lo, borderColor: 'transparent', pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0, fill: false, tension: 0, spanGaps: true, yAxisID: s.yAxisID, stack: sk + 'l', _band: true },
        { type: 'line', label: s.band, data: hi, borderColor: 'transparent', pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0, backgroundColor: fillColor, fill: '-1', tension: 0, spanGaps: true, yAxisID: s.yAxisID, stack: sk + 'h', _band: true });
    });
    return { ids, datasets, meta };
  }

  // ---------- แกนของกราฟ (รองรับกราฟแนวนอน indexAxis: 'y') ----------
  // พิกัด "logical": u = ตามแกนหมวดหมู่ (label), w = ตามแกนค่า
  const isHoriz = (chart) => !!(chart.options && chart.options.indexAxis === 'y');
  const catScale = (chart) => chart.scales[isHoriz(chart) ? 'y' : 'x'];
  const valScale = (chart) => chart.scales[chart.$valAxis || (isHoriz(chart) ? 'x' : 'y')];
  const valAxisIds = (chart) => chart.$valAxes || (isHoriz(chart) ? ['x', 'x1'] : ['y', 'y1']);
  const toLogical = (chart, px, py) => (isHoriz(chart) ? { px: py, py: px } : { px, py });   // จอ → logical
  const toScreen = (chart, u, w) => (isHoriz(chart) ? [w, u] : [u, w]);                     // logical → จอ [x, y]
  const logicalArea = (chart) => { const a = chart.chartArea; return isHoriz(chart) ? { left: a.top, right: a.bottom, top: a.left, bottom: a.right } : a; };
  const dsColor = (ds) => { const c = ds.borderColor && ds.borderColor !== 'transparent' ? ds.borderColor : ds.backgroundColor; return typeof c === 'string' ? c : '#16171B'; };

  // ---------- ตัวเลขบนจุด / crosshair ----------
  /** ข้อความค่าของจุด (ใช้ทั้ง datalabels และ crosshair) — chart.$fmtPoint(ds, idx, v) กำหนดเองได้ */
  const pointText = (chart, ds, idx, v, short) => (chart.$fmtPoint ? chart.$fmtPoint(ds, idx, v, short) : fmtNum(v, Number.isInteger(v) ? 0 : 2));
  const showPoint = (chart, ds, idx) => {
    if (!ds || ds._band || String(ds.label || '').startsWith('_')) return false;
    const v = ds.data[idx];
    if (v === null || v === undefined || Number.isNaN(v)) return false;
    if (ds._proj && chart.$projMeta && chart.$projMeta[ds.label] && chart.$projMeta[ds.label].anchor === idx) return false; // จุดเชื่อม = ค่าจริง
    return true;
  };
  /** ใส่ใน options.plugins.datalabels ของกราฟ */
  function dataLabelOptions(extra) {
    return Object.assign({
      display: (ctx) => (ctx.chart.$valuesOn && !ctx.dataset._noLabel && ctx.chart.isDatasetVisible(ctx.datasetIndex) && showPoint(ctx.chart, ctx.dataset, ctx.dataIndex) ? 'auto' : false),
      formatter: (v, ctx) => pointText(ctx.chart, ctx.dataset, ctx.dataIndex, v, true), // ช่วง 95% ดูได้ที่ tooltip/crosshair
      color: (ctx) => dsColor(ctx.dataset),
      align: 'top', anchor: 'end', offset: 2, clamp: true,
      font: { size: 10, weight: '600' }
    }, extra || {});
  }
  function syncTooltip(chart) {
    const tt = chart.options.plugins && chart.options.plugins.tooltip;
    if (tt) tt.enabled = !chart.$drawing && !chart.$crosshair;
  }
  /** on = แสดงตัวเลขทุกจุด ; off = ซ่อนตัวเลข แสดงเฉพาะค่าที่ crosshair พาดผ่าน */
  function setValueMode(chart, on) {
    if (!chart) return;
    chart.$valuesOn = !!on; chart.$crosshair = !on && !!catScale(chart) && !chart.$ownCrosshair; // กราฟวงกลม: ปิดตัวเลข = tooltip ปกติ
    syncTooltip(chart);
    chart.update('none');
  }
  /** ปุ่ม "🔢 ตัวเลข: เปิด/ปิด" — จำค่าไว้ใน localStorage */
  function valuesToggle(el, { key, onChange }) {
    const sk = 'chartValues_' + key;
    let on = !!store.get(sk, false);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ct-btn';
    const paint = () => { btn.textContent = `🔢 ตัวเลข: ${on ? 'เปิด' : 'ปิด'}`; btn.classList.toggle('active', on); };
    btn.onclick = () => { on = !on; store.set(sk, on); paint(); onChange && onChange(on); };
    paint(); el.appendChild(btn);
    return { get value() { return on; } };
  }

  // ---------- ซูม / เลื่อน (chartjs-plugin-zoom) ----------
  const hasZoom = () => typeof Chart !== 'undefined' && !!(Chart.registry && Chart.registry.plugins.get('zoom'));
  /**
   * ใส่ใน options.plugins.zoom — Ctrl + ล้อเมาส์ (หรือ pinch บนมือถือ/ทัชแพด) = ซูม, ลาก = เลื่อน
   * mode: 'x' (กราฟปกติ) หรือ 'y' (กราฟแนวนอน) ; onChange(chart) เรียกหลังซูม/เลื่อนเสร็จ
   */
  function zoomOptions(mode = 'x', onChange) {
    if (!hasZoom()) return undefined;
    const done = ({ chart }) => { if (onChange) onChange(chart); };
    return {
      limits: { [mode]: { minRange: 2 } },
      pan: { enabled: true, mode, threshold: 8, onPanComplete: (ctx) => { ctx.chart.$panAt = Date.now(); done(ctx); } }, // $panAt: กันคลิกหลังลากเลื่อน
      zoom: { wheel: { enabled: true, modifierKey: 'ctrl' }, pinch: { enabled: true }, mode, onZoomComplete: done }
    };
  }
  /** ปุ่ม "↺ รีเซ็ตซูม" — แสดงเฉพาะตอนกราฟถูกซูม/เลื่อน ; getCharts() คืนกราฟของการ์ดนี้ */
  function zoomReset(el, getCharts) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ct-btn ct-zoom-reset';
    btn.textContent = '↺ รีเซ็ตซูม'; btn.title = 'กลับไปดูทั้งช่วง';
    btn.style.display = 'none';
    const charts = () => (getCharts() || []).filter(Boolean);
    const sync = () => { btn.style.display = charts().some((c) => c.isZoomedOrPanned && c.isZoomedOrPanned()) ? '' : 'none'; };
    btn.onclick = () => { charts().forEach((c) => c.resetZoom && c.resetZoom()); sync(); };
    if (hasZoom()) {
      const hint = document.createElement('span');
      hint.className = 'ct-hint'; hint.textContent = 'Ctrl + ล้อเมาส์ = ซูม · ลาก = เลื่อน';
      el.appendChild(hint);
    }
    el.appendChild(btn);
    return { sync };
  }
  /** ซูมกราฟอื่นตามกราฟต้นทาง (แกน X ร่วมกัน) */
  function syncZoom(src, others) {
    const sc = src.scales.x; if (!sc) return;
    others.filter((c) => c && c !== src && c.zoomScale).forEach((c) => {
      if (src.isZoomedOrPanned()) c.zoomScale('x', { min: sc.min, max: sc.max }, 'none');
      else c.resetZoom('none');
    });
  }

  // ---------- ขยายเต็มจอ ----------
  /** ปุ่ม "⛶ ขยาย" — ขยายการ์ด (กราฟ + แถบควบคุม + เครื่องมือ) เต็มจอ ; กดอีกครั้งหรือ Esc เพื่อย่อ */
  function expandButton(el, card) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ct-btn ct-expand';
    let backdrop = null;
    const isOpen = () => card.classList.contains('ct-full');
    const paint = () => { btn.textContent = isOpen() ? '✕ ย่อ' : '⛶ ขยาย'; btn.title = isOpen() ? 'ย่อกลับ (Esc)' : 'ขยายกราฟเต็มจอ'; };
    const close = () => {
      if (!isOpen()) return;
      card.classList.remove('ct-full'); document.body.classList.remove('ct-full-open');
      if (backdrop) { backdrop.remove(); backdrop = null; }
      paint();
    };
    const open = () => {
      document.querySelectorAll('.ct-full').forEach((c) => { if (c !== card && c.$ctClose) c.$ctClose(); });
      backdrop = document.createElement('div'); backdrop.className = 'ct-backdrop'; backdrop.onclick = close;
      document.body.appendChild(backdrop);
      card.classList.add('ct-full'); document.body.classList.add('ct-full-open');
      paint();
    };
    card.$ctClose = close;
    btn.onclick = () => (isOpen() ? close() : open());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
    paint(); el.appendChild(btn);
    return { open, close, get isOpen() { return isOpen(); } };
  }

  // ---------- Period switcher (Segmented control) ----------
  const switchers = [];
  /**
   * el: กล่องที่จะใส่ปุ่ม ; key: ชื่อกราฟ ; onChange(period)
   * มีช่อง "ทุกกราฟ" — ติ๊กแล้วกดเปลี่ยนช่วงจะสลับทุกกราฟที่ใช้ periodSwitcher พร้อมกัน
   * periods: เลือกเฉพาะบางช่วง เช่น ['month', 'quarter', 'year'] สำหรับข้อมูลรายเดือน (ค่าเริ่มต้น = ทุกช่วง)
   */
  function periodSwitcher(el, { key, onChange, allOption = true, periods }) {
    const list = PERIODS.filter((p) => !periods || periods.includes(p[0]));
    const allowed = (v) => list.some((p) => p[0] === v);
    const allOn = () => allOption && !!store.get('chartPeriod_all', false);
    let value = (allOn() && store.get('chartPeriod_allValue', null)) || store.get('chartPeriod_' + key, list[0][0]);
    if (!allowed(value)) value = store.get('chartPeriod_' + key, list[0][0]);
    if (!allowed(value)) value = list[0][0];
    const wrap = document.createElement('div');
    wrap.className = 'ct-period';
    const seg = document.createElement('div');
    seg.className = 'ct-seg'; seg.setAttribute('role', 'group');
    seg.innerHTML = list.map(([k, t]) => `<button type="button" data-p="${k}">${t}</button>`).join('');
    wrap.appendChild(seg);
    let allBox = null;
    if (allOption) {
      const lab = document.createElement('label');
      lab.className = 'ct-all'; lab.title = 'สลับช่วงทุกกราฟพร้อมกัน';
      lab.innerHTML = '<input type="checkbox"> ทุกกราฟ';
      allBox = lab.querySelector('input'); allBox.checked = allOn();
      allBox.onchange = () => { store.set('chartPeriod_all', allBox.checked); switchers.forEach((s) => s.syncAll(allBox.checked)); };
      wrap.appendChild(lab);
    }
    el.appendChild(wrap);
    const paint = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.p === value));
    const self = {
      key,
      get value() { return value; },
      set(v, fire = true) { if (v === value || !allowed(v)) return; value = v; store.set('chartPeriod_' + key, v); paint(); if (fire && onChange) onChange(v); },
      syncAll(on) { if (allBox) allBox.checked = on; }
    };
    seg.onclick = (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      if (allOn()) { store.set('chartPeriod_allValue', b.dataset.p); switchers.forEach((s) => s.set(b.dataset.p)); }
      else self.set(b.dataset.p);
    };
    if (allOption) switchers.push(self); // ไม่มีช่อง "ทุกกราฟ" = ไม่สลับตามกราฟอื่น
    paint();
    return self;
  }

  // ---------- Drawing tools ----------
  const COLORS = [['#C8102E', 'แดง'], ['#2F6FDE', 'น้ำเงิน'], ['#1E9E5A', 'เขียว'], ['#7B3FC4', 'ม่วง'], ['#16171B', 'ดำ']];
  const HIT = 8; // px
  const TOOLS = [
    ['trend', '✏️', 'เส้นแนวโน้ม — กดจุดแรกแล้วลาก (หรือคลิก) ไปจุดที่สอง'],
    ['hline', '━', 'เส้นระดับค่า (แนวนอน) — คลิกครั้งเดียว'],
    ['range', '⏱️', 'วัดช่วงเวลา — คลิกวันเริ่ม แล้วคลิกวันสิ้นสุด'],
    ['cycle', '🔁', 'เส้นคาบซ้ำ — คลิกจุดเริ่ม แล้วคลิกจุดสิ้นสุดของคาบแรก'],
    ['select', '✋', 'เลือก/แก้ไข — ลากย้ายเส้นหรือจุดปลาย, Delete = ลบเส้นที่เลือก']
  ];
  const ALL_TOOLS = ['trend', 'hline', 'range', 'cycle', 'select', 'erase', 'color', 'undo', 'clear'];
  const hasInteractive = (c) => c && c.scales && c.chartArea && catScale(c) && valScale(c) && catScale(c).type === 'category';

  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /**
   * แถบเครื่องมือตีเส้น — เรียกทุกครั้งหลังสร้างกราฟใหม่ (destroy/new Chart) บน canvas เดิมได้
   * key: ชื่อกราฟ (เส้นเก็บใน localStorage 'h1ls_chartDrawings_<key>') ; opts.toolbarKey: ใช้จำตำแหน่ง toolbar
   * opts.tools: ปุ่มที่ต้องการ (ค่าเริ่มต้น = ทั้งหมด) เช่น ['trend', 'hline', 'select', 'erase', 'color', 'undo', 'clear']
   *   — 'range' / 'cycle' เหมาะกับกราฟที่แกนหมวดหมู่เป็นเวลา ; รองรับกราฟแนวนอน (indexAxis: 'y')
   */
  function initChartDrawTool(chart, key, opts = {}) {
    if (!chart || !chart.canvas) return null;
    const canvas = chart.canvas;
    let st = canvas.__ctDraw;
    if (!st) st = canvas.__ctDraw = createDrawState(canvas, opts.toolbarKey || key, opts.tools || ALL_TOOLS);
    if (st.key !== key) { st.key = key; st.shapes = store.get('chartDrawings_' + key, []); st.selected = -1; st.pending = null; }
    st.chart = chart;
    chart.$draw = st;
    chart.$drawing = !!st.mode && st.mode !== 'none';
    applyDrawingState(st);
    return st;
  }

  function applyDrawingState(st) {
    const c = st.chart; if (!c) return;
    c.$drawing = !!st.mode;
    syncTooltip(c);
    const z = c.options.plugins && c.options.plugins.zoom; // ปิด pan/zoom ชั่วคราว (ถ้ามี chartjs-plugin-zoom)
    if (z) {
      if (!st.zoomSaved) st.zoomSaved = { pan: z.pan && z.pan.enabled, wheel: z.zoom && z.zoom.wheel && z.zoom.wheel.enabled, pinch: z.zoom && z.zoom.pinch && z.zoom.pinch.enabled, drag: z.zoom && z.zoom.drag && z.zoom.drag.enabled };
      const s = st.zoomSaved, on = !st.mode;
      if (z.pan) z.pan.enabled = on && s.pan;
      if (z.zoom && z.zoom.wheel) z.zoom.wheel.enabled = on && s.wheel;
      if (z.zoom && z.zoom.pinch) z.zoom.pinch.enabled = on && s.pinch;
      if (z.zoom && z.zoom.drag) z.zoom.drag.enabled = on && s.drag;
    }
    st.canvas.style.cursor = st.mode === 'select' ? 'default' : st.mode ? 'crosshair' : '';
    st.canvas.style.touchAction = st.mode ? 'none' : '';
    if (st.tb) {
      st.tb.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === st.mode));
      st.tb.querySelector('[data-act="color"] i').style.background = st.color;
    }
    try { c.update('none'); } catch (e) { /* ถูก destroy แล้ว */ }
  }

  function createDrawState(canvas, tbKey, tools) {
    const st = { canvas, chart: null, key: null, shapes: [], mode: null, color: COLORS[0][0], pending: null, hover: null, selected: -1, drag: null, tb: null };
    const save = () => store.set('chartDrawings_' + st.key, st.shapes);
    const redraw = () => { if (st.chart) st.chart.draw(); };

    // --- แปลงพิกัด pixel ↔ ข้อมูล ---
    const labels = () => (st.chart.data.labels || []);
    // (px, py) ในส่วนนี้เป็นพิกัด logical: px = ตามแกนหมวดหมู่, py = ตามแกนค่า
    const xIdxAt = (px) => { const n = labels().length; const v = Math.round(catScale(st.chart).getValueForPixel(px)); return Math.max(0, Math.min(n - 1, v)); };
    const toData = (px, py) => ({ x: labels()[xIdxAt(px)], y: valScale(st.chart).getValueForPixel(py) });
    const xPix = (lab) => { const i = labels().indexOf(lab); return i < 0 ? null : catScale(st.chart).getPixelForValue(i); };
    const yPix = (v) => valScale(st.chart).getPixelForValue(v);
    const shiftLab = (lab, d) => { const L = labels(), i = L.indexOf(lab); return i < 0 ? lab : L[Math.max(0, Math.min(L.length - 1, i + d))]; };

    // --- toolbar ---
    const host = canvas.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const tb = st.tb = document.createElement('div');
    tb.className = 'ct-draw-tb';
    tb.innerHTML = `<span class="ct-handle" title="ลากเพื่อย้ายแถบเครื่องมือ">⠿</span>` +
      TOOLS.filter(([k]) => tools.includes(k)).map(([k, ic, t]) => `<button type="button" data-tool="${k}" title="${t}">${ic}</button>`).join('') +
      `<button type="button" data-act="color" title="สีเส้น (กดเพื่อเปลี่ยน)"><i></i></button>` +
      (tools.includes('erase') ? `<button type="button" data-tool="erase" title="ยางลบ — คลิกใกล้เส้นเพื่อลบ">🧽</button>` : '') +
      (tools.includes('undo') ? `<button type="button" data-act="undo" title="Undo — ลบเส้นล่าสุด">↩️</button>` : '') +
      (tools.includes('clear') ? `<button type="button" data-act="clear" title="ลบเส้นทั้งหมด">🗑️</button>` : '');
    host.appendChild(tb);
    const pos = store.get('drawToolbarPos_' + tbKey, null);
    if (pos) { tb.style.left = pos.left + 'px'; tb.style.top = pos.top + 'px'; }

    tb.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) {
        st.mode = st.mode === b.dataset.tool ? null : b.dataset.tool;
        st.pending = null; st.hover = null; if (st.mode !== 'select') st.selected = -1;
        applyDrawingState(st);
      } else if (b.dataset.act === 'color') {
        const i = COLORS.findIndex((c) => c[0] === st.color);
        st.color = COLORS[(i + 1) % COLORS.length][0];
        b.title = `สีเส้น: ${COLORS[(i + 1) % COLORS.length][1]} (กดเพื่อเปลี่ยน)`;
        if (st.selected >= 0 && st.shapes[st.selected]) { st.shapes[st.selected].c = st.color; save(); }
        applyDrawingState(st);
      } else if (b.dataset.act === 'undo') {
        st.shapes.pop(); st.selected = -1; save(); redraw();
      } else if (b.dataset.act === 'clear') {
        if (!st.shapes.length || !window.confirm('ลบเส้นทั้งหมดบนกราฟนี้?')) return;
        st.shapes = []; st.selected = -1; save(); redraw();
      }
    });

    // ลาก toolbar ด้วยที่จับ
    const handle = tb.querySelector('.ct-handle');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r0 = tb.getBoundingClientRect(), hr = host.getBoundingClientRect();
      const ox = e.clientX - r0.left, oy = e.clientY - r0.top;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const left = Math.max(0, Math.min(hr.width - tb.offsetWidth, ev.clientX - hr.left - ox));
        const top = Math.max(-40, Math.min(hr.height - tb.offsetHeight, ev.clientY - hr.top - oy));
        tb.style.left = left + 'px'; tb.style.top = top + 'px';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        store.set('drawToolbarPos_' + tbKey, { left: parseFloat(tb.style.left) || 0, top: parseFloat(tb.style.top) || 0 });
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });

    // --- hit test ---
    function hitTest(px, py) {
      const a = logicalArea(st.chart);
      for (let i = st.shapes.length - 1; i >= 0; i--) {
        const s = st.shapes[i];
        if (s.t === 'trend') {
          const ax = xPix(s.a.x), bx = xPix(s.b.x); if (ax === null || bx === null) continue;
          const ay = yPix(s.a.y), by = yPix(s.b.y);
          if (Math.hypot(px - ax, py - ay) <= HIT) return { i, part: 'a' };
          if (Math.hypot(px - bx, py - by) <= HIT) return { i, part: 'b' };
          if (distSeg(px, py, ax, ay, bx, by) <= HIT) return { i, part: 'all' };
        } else if (s.t === 'hline') {
          if (Math.abs(py - yPix(s.y)) <= HIT && px >= a.left && px <= a.right) return { i, part: 'all' };
        } else if (s.t === 'range') {
          const ax = xPix(s.a), bx = xPix(s.b); if (ax === null || bx === null) continue;
          if (Math.abs(px - ax) <= HIT) return { i, part: 'a' };
          if (Math.abs(px - bx) <= HIT) return { i, part: 'b' };
          if (px >= Math.min(ax, bx) && px <= Math.max(ax, bx)) return { i, part: 'all' };
        } else if (s.t === 'cycle') {
          const xs = cycleXs(s); if (!xs) continue;
          for (let k = 0; k < xs.length; k++) if (Math.abs(px - xs[k]) <= HIT) return { i, part: k === 1 ? 'b' : k === 0 ? 'a' : 'all' };
        }
      }
      return null;
    }
    function cycleXs(s) {
      const L = labels(); let i1 = L.indexOf(s.a), i2 = L.indexOf(s.b);
      if (i1 < 0 || i2 < 0) return null;
      if (i2 < i1) [i1, i2] = [i2, i1];
      const cs = catScale(st.chart), n = i2 - i1; if (!n) return [cs.getPixelForValue(i1)];
      const xs = [];
      for (let i = i1; i < L.length; i += n) xs.push(cs.getPixelForValue(i));
      return xs;
    }
    st.cycleXs = cycleXs; st.xPix = xPix; st.yPix = yPix;

    // --- pointer events บน canvas ---
    const ptOf = (e) => { const r = canvas.getBoundingClientRect(); return toLogical(st.chart, e.clientX - r.left, e.clientY - r.top); };
    const inArea = (p) => { const a = logicalArea(st.chart); return p.px >= a.left - 4 && p.px <= a.right + 4 && p.py >= a.top - 4 && p.py <= a.bottom + 4; };
    let downAt = null;

    function finish(p) {
      const d = toData(p.px, p.py), s0 = st.pending;
      if (st.mode === 'trend') st.shapes.push({ t: 'trend', a: s0, b: { x: d.x, y: d.y }, c: st.color });
      else if (st.mode === 'range') st.shapes.push({ t: 'range', a: s0.x, b: d.x, c: st.color });
      else if (st.mode === 'cycle') st.shapes.push({ t: 'cycle', a: s0.x, b: d.x, c: st.color });
      st.pending = null; st.hover = null; save(); redraw();
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (!st.mode || !hasInteractive(st.chart)) return;
      const p = ptOf(e); if (!inArea(p)) return;
      e.preventDefault();
      downAt = p;
      if (st.mode === 'hline') { st.shapes.push({ t: 'hline', y: toData(p.px, p.py).y, c: st.color }); save(); redraw(); return; }
      if (st.mode === 'erase') { const h = hitTest(p.px, p.py); if (h) { st.shapes.splice(h.i, 1); st.selected = -1; save(); redraw(); } return; }
      if (st.mode === 'select') {
        const h = hitTest(p.px, p.py);
        st.selected = h ? h.i : -1;
        if (h) { st.drag = { part: h.part, start: toData(p.px, p.py), startIdx: xIdxAt(p.px), orig: JSON.parse(JSON.stringify(st.shapes[h.i])) }; canvas.setPointerCapture(e.pointerId); }
        redraw(); return;
      }
      if (st.pending) { finish(p); return; } // คลิกครั้งที่สอง
      st.pending = toData(p.px, p.py); st.hover = st.pending;
      canvas.setPointerCapture(e.pointerId);
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!st.mode || !hasInteractive(st.chart)) return;
      const p = ptOf(e);
      if (st.mode === 'select' && st.drag && st.selected >= 0) {
        const s = st.shapes[st.selected], o = st.drag.orig, cur = toData(p.px, p.py);
        const dIdx = xIdxAt(p.px) - st.drag.startIdx, dy = cur.y - st.drag.start.y;
        if (s.t === 'trend') {
          if (st.drag.part === 'a') s.a = { x: cur.x, y: cur.y };
          else if (st.drag.part === 'b') s.b = { x: cur.x, y: cur.y };
          else { s.a = { x: shiftLab(o.a.x, dIdx), y: o.a.y + dy }; s.b = { x: shiftLab(o.b.x, dIdx), y: o.b.y + dy }; }
        } else if (s.t === 'hline') s.y = o.y + dy;
        else if (st.drag.part === 'a') s.a = cur.x;
        else if (st.drag.part === 'b') s.b = cur.x;
        else { s.a = shiftLab(o.a, dIdx); s.b = shiftLab(o.b, dIdx); }
        redraw(); return;
      }
      if (st.pending) { st.hover = toData(p.px, p.py); redraw(); }
    });
    const endPtr = (e) => {
      if (!st.mode) return;
      if (st.drag) { st.drag = null; save(); return; }
      if (st.pending && downAt && e.type === 'pointerup') {
        const p = ptOf(e);
        if (Math.hypot(p.px - downAt.px, p.py - downAt.py) > 6) finish(p); // ลากแล้วปล่อย = จบเส้น
      }
      downAt = null;
    };
    canvas.addEventListener('pointerup', endPtr);
    canvas.addEventListener('pointercancel', endPtr);

    document.addEventListener('keydown', (e) => {
      if (st.selected < 0 || !st.chart || !document.body.contains(canvas)) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); st.shapes.splice(st.selected, 1); st.selected = -1; save(); redraw(); }
      else if (e.key === 'Escape') { st.selected = -1; st.pending = null; redraw(); }
    });
    return st;
  }

  // ---------- วาดเส้น (plugin afterDraw) ----------
  function label(ctx, text, x, y, color, align = 'left') {
    ctx.font = "600 11px Sarabun, sans-serif";
    const w = ctx.measureText(text).width + 8, h = 16;
    const lx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = color; ctx.fillRect(lx, y - h / 2, w, h);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, lx + 4, y + 0.5);
  }
  function axisText(chart, py) {
    const parts = [];
    valAxisIds(chart).forEach((id) => {
      const sc = chart.scales[id]; if (!sc) return;
      const v = sc.getValueForPixel(py);
      parts.push(chart.$axisFmt && chart.$axisFmt[id] ? chart.$axisFmt[id](v) : fmtNum(v, Math.abs(v) < 100 ? 2 : 0));
    });
    return parts.join(' · ');
  }
  function daysBetween(chart, a, b) {
    const p = chart.$period || 'day';
    let [s, e] = a <= b ? [a, b] : [b, a];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return null;
    e = periodEnd(e, p);
    return Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
  }
  function drawShape(chart, st, s, sel, preview) {
    const ctx = chart.ctx, a = logicalArea(chart), H = isHoriz(chart);
    // วาดด้วยพิกัด logical แล้วแปลงเป็นพิกัดจอ (กราฟแนวนอนสลับแกน)
    const P = (u, w) => toScreen(chart, u, w);
    const mv = (u, w) => ctx.moveTo(...P(u, w)), ln = (u, w) => ctx.lineTo(...P(u, w));
    const lbl = (text, u, w, color, align) => { const [x, y] = P(u, w); label(ctx, text, x, y, color, H ? (align === 'right' ? 'center' : align) : align); };
    ctx.save();
    ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineWidth = sel ? 2.5 : 1.75;
    if (preview) ctx.setLineDash([5, 4]);
    if (s.t === 'trend') {
      const ax = st.xPix(s.a.x), bx = st.xPix(s.b.x);
      if (ax !== null && bx !== null) {
        const ay = st.yPix(s.a.y), by = st.yPix(s.b.y);
        ctx.beginPath(); mv(ax, ay); ln(bx, by); ctx.stroke();
        [P(ax, ay), P(bx, by)].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, sel ? 4.5 : 3, 0, Math.PI * 2); sel ? (ctx.fillStyle = '#fff', ctx.fill(), ctx.stroke(), ctx.fillStyle = s.c) : ctx.fill(); });
      }
    } else if (s.t === 'hline') {
      const y = st.yPix(s.y);
      if (y >= a.top && y <= a.bottom) {
        ctx.beginPath(); mv(a.left, y); ln(a.right, y); ctx.stroke();
        lbl(axisText(chart, y), H ? a.right - 9 : a.right, y, s.c, 'right');
      }
    } else if (s.t === 'range') {
      const ax = st.xPix(s.a), bx = st.xPix(s.b);
      if (ax !== null && bx !== null) {
        const l = Math.min(ax, bx), r = Math.max(ax, bx);
        ctx.globalAlpha = 0.14; ctx.beginPath(); mv(l, a.top); ln(r, a.top); ln(r, a.bottom); ln(l, a.bottom); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
        ctx.beginPath(); mv(l, a.top); ln(l, a.bottom); mv(r, a.top); ln(r, a.bottom); ctx.stroke();
        const n = daysBetween(chart, s.a, s.b);
        const per = chart.data.labels.indexOf(s.b) - chart.data.labels.indexOf(s.a);
        const txt = n === null ? `${Math.abs(per) + 1} ช่วง` : `${n} วัน` + ((chart.$period || 'day') !== 'day' ? ` (${Math.abs(per) + 1} ช่วง)` : '');
        lbl(txt, (l + r) / 2, a.top + 10, s.c, 'center');
      }
    } else if (s.t === 'cycle') {
      const xs = st.cycleXs(s);
      if (xs) {
        ctx.setLineDash(preview ? [5, 4] : [6, 3]);
        xs.forEach((x, k) => { ctx.globalAlpha = k < 2 ? 1 : 0.7; ctx.beginPath(); mv(x, a.top); ln(x, a.bottom); ctx.stroke(); });
        ctx.globalAlpha = 1;
        if (xs.length > 1) { ctx.beginPath(); ctx.setLineDash([]); mv(xs[0], a.bottom - 6); ln(xs[1], a.bottom - 6); ctx.stroke(); }
      }
    }
    ctx.restore();
  }

  const drawPlugin = {
    id: 'ctDrawTools',
    afterDraw(chart) {
      const st = chart.$draw;
      if (!st || st.chart !== chart || !hasInteractive(chart)) return;
      const ctx = chart.ctx, a = chart.chartArea;
      ctx.save();
      ctx.beginPath(); ctx.rect(a.left, a.top - 2, a.right - a.left, a.bottom - a.top + 4); ctx.clip();
      st.shapes.forEach((s, i) => drawShape(chart, st, s, i === st.selected, false));
      if (st.pending && st.hover) {
        const pv = st.mode === 'trend' ? { t: 'trend', a: st.pending, b: st.hover, c: st.color }
          : { t: st.mode, a: st.pending.x, b: st.hover.x, c: st.color };
        drawShape(chart, st, pv, false, true);
      }
      ctx.restore();
    }
  };

  // crosshair ตามเมาส์ (ตั้งฉากกับแกนหมวดหมู่) + ค่าของจุดที่เส้นพาดผ่าน (เมื่อปิดตัวเลข)
  const crosshairPlugin = {
    id: 'ctCrosshair',
    afterEvent(chart, args) {
      if (!chart.$crosshair) return;
      const e = args.event;
      if (e.type === 'mouseout') { if (chart.$hoverIdx !== null) { chart.$hoverIdx = null; args.changed = true; } return; }
      const cs = catScale(chart);
      if (e.type !== 'mousemove' || !cs) return;
      const a = chart.chartArea, n = (chart.data.labels || []).length;
      const p = toLogical(chart, e.x, e.y);
      let idx = e.x >= a.left && e.x <= a.right && e.y >= a.top && e.y <= a.bottom ? Math.round(cs.getValueForPixel(p.px)) : null;
      if (idx !== null && (idx < 0 || idx >= n)) idx = null;
      if (idx !== chart.$hoverIdx) { chart.$hoverIdx = idx; args.changed = true; }
    },
    afterDatasetsDraw(chart) {
      const idx = chart.$hoverIdx, cs = catScale(chart);
      if (!chart.$crosshair || idx === null || idx === undefined || !cs || idx < 0 || idx >= (chart.data.labels || []).length) return;
      const ctx = chart.ctx, a = logicalArea(chart), H = isHoriz(chart), u = cs.getPixelForValue(idx);
      const P = (uu, ww) => toScreen(chart, uu, ww);
      ctx.save();
      ctx.strokeStyle = 'rgba(22,23,27,.45)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(...P(u, a.top)); ctx.lineTo(...P(u, a.bottom)); ctx.stroke(); ctx.setLineDash([]);
      const title = chart.$fmtLabel ? chart.$fmtLabel(chart.data.labels[idx]) : String(chart.data.labels[idx]);
      if (H) label(ctx, title, chart.chartArea.right, u - 12, '#16171B', 'right');
      else label(ctx, title, u, a.bottom - 9, '#16171B', 'center');
      const items = [];
      chart.data.datasets.forEach((ds, di) => {
        if (!chart.isDatasetVisible(di) || !showPoint(chart, ds, idx)) return;
        const sc = chart.scales[(H ? ds.xAxisID : ds.yAxisID) || (H ? 'x' : 'y')]; if (!sc) return;
        // ใช้ตำแหน่งของจุด/แท่งที่วาดจริง (แท่งซ้อน = ปลายแท่ง) ถ้ามี ; ไม่งั้นคำนวณจากค่า
        const el = chart.getDatasetMeta(di).data[idx];
        const w = el && Number.isFinite(H ? el.x : el.y) ? (H ? el.x : el.y) : sc.getPixelForValue(ds.data[idx]);
        items.push({ w, text: pointText(chart, ds, idx, ds.data[idx]), color: dsColor(ds) });
      });
      if (H) {
        // แนวนอน: ป้ายเรียงใต้เส้น crosshair
        items.forEach((it, k) => {
          ctx.beginPath(); ctx.fillStyle = it.color; ctx.arc(it.w, u, 3.5, 0, Math.PI * 2); ctx.fill();
          label(ctx, it.text, Math.min(it.w + 8, chart.chartArea.right - 60), u + 12 + k * 17, it.color, 'left');
        });
      } else {
        items.sort((p, q) => p.w - q.w);
        let last = -Infinity; // กันป้ายทับกัน
        const right = u + 8 + 140 < a.right;
        items.forEach((it) => {
          const y = Math.max(it.w, last + 17); last = y;
          ctx.beginPath(); ctx.fillStyle = it.color; ctx.arc(u, it.w, 3.5, 0, Math.PI * 2); ctx.fill();
          label(ctx, it.text, right ? u + 8 : u - 8, Math.min(y, a.bottom - 26), it.color, right ? 'left' : 'right');
        });
      }
      ctx.restore();
    }
  };
  if (typeof Chart !== 'undefined') Chart.register(drawPlugin, crosshairPlugin);

  return {
    PERIODS, periodLabel, periodStart, periodEnd, nextPeriod, aggregate, buildProjection,
    initChartDrawTool, periodSwitcher, valuesToggle, setValueMode, dataLabelOptions, store,
    zoomOptions, zoomReset, syncZoom, expandButton
  };
})();
// const ระดับบนสุดไม่ได้เป็น property ของ window — ให้หน้าเว็บเช็ก window.ChartTools ได้
if (typeof window !== 'undefined') window.ChartTools = ChartTools;
