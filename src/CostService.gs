/**
 * Cost Management Service (P&L Structure)
 */

var COST_ITEMS = [
  { code: 'FG', label: 'FG Produced', group: 'revenue', editable: false, order: 1, formula: '', percentBase: false },
  { code: 'UNITPRICE', label: 'Unit Price', group: 'revenue', editable: true, order: 2, formula: '', percentBase: false },
  { code: 'SALE', label: 'Sale (FG × Unit Price)', group: 'revenue', editable: false, order: 3, formula: 'FG*UNITPRICE' },
  { code: 'RM', label: 'RM', group: 'cogs', editable: true, order: 10, formula: '' },
  { code: 'SUBCON', label: 'Sub con', group: 'cogs', editable: true, order: 11, formula: '' },
  { code: 'DLSUM', label: 'DL (sum)', group: 'cogs', editable: false, order: 12, formula: 'DL+DLSUP' },
  { code: 'OTSUM', label: 'OT (sum)', group: 'cogs', editable: false, order: 13, formula: 'OT+OTSUP' },
  { code: 'DL', label: 'DL', group: 'cogs', editable: false, order: 14, formula: '', hidden: true },
  { code: 'OT', label: 'OT', group: 'cogs', editable: false, order: 15, formula: '', hidden: true },
  { code: 'DLSUP', label: 'DL sup&mini MD', group: 'cogs', editable: false, order: 16, formula: '', hidden: true },
  { code: 'OTSUP', label: 'OT sup&mini MD', group: 'cogs', editable: false, order: 17, formula: '', hidden: true },
  { code: 'OHVC', label: 'OH VC', group: 'cogs', editable: false, order: 20, formula: 'UTIL+SUBCONTRACT+ACCESS+REPAIR+OTHERVC' },
  { code: 'UTIL', label: 'Utilities', group: 'cogs', editable: true, order: 21, formula: '' },
  { code: 'SUBCONTRACT', label: 'Subcontract', group: 'cogs', editable: true, order: 22, formula: '' },
  { code: 'ACCESS', label: 'Accessories', group: 'cogs', editable: true, order: 23, formula: '' },
  { code: 'REPAIR', label: 'Repair', group: 'cogs', editable: true, order: 24, formula: '' },
  { code: 'OTHERVC', label: 'Other', group: 'cogs', editable: true, order: 25, formula: '' },
  { code: 'OHFC', label: 'OH FC', group: 'cogs', editable: true, order: 30, formula: '' },
  { code: 'COGS', label: 'COGS', group: 'calc', editable: false, order: 40, formula: 'RM+SUBCON+DLSUM+OTSUM+OHVC+OHFC' },
  { code: 'GP', label: 'Gross Profit', group: 'calc', editable: false, order: 50, formula: 'SALE-COGS' },
  { code: 'SELLVC', label: 'Selling VC', group: 'sgna', editable: true, order: 60, formula: '' },
  { code: 'TRANS', label: 'Transportation', group: 'sgna', editable: true, order: 61, formula: '' },
  { code: 'ADMINFC', label: 'Admin FC', group: 'sgna', editable: true, order: 62, formula: '' },
  { code: 'STAFFADM', label: 'Staff (Admin)', group: 'sgna', editable: true, order: 63, formula: '' },
  { code: 'SGA', label: 'SG & A', group: 'calc', editable: false, order: 70, formula: 'SELLVC+ADMINFC' },
  { code: 'PROFIT', label: 'Profit', group: 'calc', editable: false, order: 80, formula: 'GP-SGA' },
  { code: 'OTHERINC', label: 'Other income', group: 'below', editable: true, order: 90, formula: '' },
  { code: 'EXBONAD', label: 'Extra Bonus-Admin', group: 'below', editable: true, order: 91, formula: '' },
  { code: 'EXBONOH', label: 'Extra Bonus-OH', group: 'below', editable: true, order: 92, formula: '' },
  { code: 'MGTBON', label: 'Mgt Bonus', group: 'below', editable: true, order: 93, formula: '' },
  { code: 'EXTRA', label: 'Extra', group: 'below', editable: true, order: 94, formula: '' },
  { code: 'EBIT', label: 'EBIT', group: 'calc', editable: false, order: 100, formula: 'PROFIT+OTHERINC+EXBONAD+EXBONOH+MGTBON+EXTRA' },
  { code: 'INTEREST', label: 'Interest', group: 'below', editable: true, order: 101, formula: '' },
  { code: 'TAX', label: 'Tax', group: 'below', editable: true, order: 102, formula: '' },
  { code: 'EAT', label: 'EAT', group: 'calc', editable: false, order: 110, formula: 'EBIT-INTEREST-TAX' }
];

var COST_PL_HEADERS = ['ProductCode', 'ItemCode', 'YearMonth', 'Amount', 'UpdatedAt', 'UpdatedBy'];

function canViewCostModule(user) { var role = String((user && user.role) || '').toLowerCase(); return role === 'admin' || role === 'supervisor'; }
function ensureCostSheets() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('CostPLConfig');
  if (!sheet) {
    createSheetIfNotExists(ss, 'CostPLConfig', COST_PL_HEADERS);
    return;
  }
  var header = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  if (header.indexOf('YearMonth') === -1) {
    // Old single-snapshot schema (no month dimension) — replaced by the monthly schema below.
    sheet.clear();
    sheet.getRange(1, 1, 1, COST_PL_HEADERS.length).setValues([COST_PL_HEADERS]);
    sheet.getRange(1, 1, 1, COST_PL_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

// yearMonth: 'YYYY-MM'. Falls back to the current month if missing/invalid.
function getCostMonthRange(yearMonth) {
  var ym = /^\d{4}-\d{2}$/.test(String(yearMonth || '')) ? String(yearMonth) : formatDateOnly(new Date()).substring(0, 7);
  var year = Number(ym.substring(0, 4));
  var month = Number(ym.substring(5, 7));
  var lastDay = new Date(year, month, 0).getDate();
  return { yearMonth: ym, from: ym + '-01', to: ym + '-' + ('0' + lastDay).slice(-2) };
}

function getCostItems() { return COST_ITEMS.slice().sort(function(a,b){return a.order-b.order;}); }
function evalFormula(formula, map) {
  if (!formula) return null;
  var expr = formula.replace(/[A-Z]+/g, function(k){ return Number(map[k] || 0); });
  if (!/^[0-9+\-*/(). ]+$/.test(expr)) return 0;
  try { return Number(Function('return ' + expr)()) || 0; } catch (e) { return 0; }
}

function getCostProducts(dateFrom, dateTo) {
  var productMap = {};

  getProducts().forEach(function(p) {
    var code = String(p.productCode || '').trim();
    if (!code) return;
    productMap[code] = {
      productCode: code,
      productName: p.productName || '',
      defaultQty: p.defaultQty || 1300,
      active: p.active,
      source: 'Products',
      totalFg: 0,
      entries: 0
    };
  });

  findRows('ProductionLog', function(log) {
    return (!dateFrom || log.Date >= dateFrom) && (!dateTo || log.Date <= dateTo);
  }).forEach(function(log) {
    if (String(log.Status || '').toLowerCase() === 'cancelled') return;
    var code = String(log.ProductCode || '').trim();
    if (!code) return;
    if (!productMap[code]) {
      productMap[code] = {
        productCode: code,
        productName: code,
        defaultQty: Number(log.PlannedQty) || 1300,
        active: true,
        source: 'ProductionLog',
        totalFg: 0,
        entries: 0
      };
    }
    productMap[code].totalFg += Number(log.ActualQty) || 0;
    productMap[code].entries += 1;
  });

  return Object.keys(productMap).sort().map(function(code) {
    return productMap[code];
  });
}

// Computes the P&L line matrix for a set of products given their saved CostPLConfig values.
// byProduct: { productCode: { itemCode: amount } } for the month in question.
function computeCostMatrix(products, byProduct) {
  var items = getCostItems();
  return products.map(function(p){
    var vals = byProduct[p.productCode] || {};
    vals = Object.assign({}, vals);
    vals.FG = Number(p.totalFg) || 0;
    items.forEach(function(it){ if (!it.formula && vals[it.code] == null) vals[it.code] = 0; });
    items.forEach(function(it){ if (it.formula) vals[it.code] = evalFormula(it.formula, vals); });
    var sale = Number(vals.SALE) || 0;
    var lines = items.filter(function(it){ return !it.hidden; }).map(function(it){
      var amt = Number(vals[it.code]) || 0;
      var pct = it.percentBase === false ? null : (sale !== 0 ? (amt / sale) * 100 : 0);
      return { code: it.code, label: it.label, group: it.group, editable: it.editable, amount: amt, percent: pct };
    });
    return { productCode: p.productCode, productName: p.productName, source: p.source || 'Products', totalFg: p.totalFg || 0, entries: p.entries || 0, lines: lines, values: vals };
  });
}

function getCostConfigByMonth(yearMonth) {
  var rows = findRows('CostPLConfig', function(r){ return String(r.YearMonth||'') === yearMonth; });
  var byProduct = {};
  rows.forEach(function(r){
    var p = String(r.ProductCode||''); var c = String(r.ItemCode||'');
    if (!byProduct[p]) byProduct[p] = {};
    byProduct[p][c] = Number(r.Amount) || 0;
  });
  return byProduct;
}

function getCostPL(token, yearMonth) {
  var user = validateSession(token);
  if (!user) return { success:false, message:'กรุณาเข้าสู่ระบบใหม่' };
  if (!canViewCostModule(user)) return { success:false, message:'ไม่มีสิทธิ์เข้าถึงข้อมูลต้นทุน' };
  ensureCostSheets();

  var range = getCostMonthRange(yearMonth);
  var products = getCostProducts(range.from, range.to);
  var byProduct = getCostConfigByMonth(range.yearMonth);
  var matrix = computeCostMatrix(products, byProduct);
  return { success: true, yearMonth: range.yearMonth, items: matrix };
}

function saveCostPL(token, yearMonth, rows) {
  var user = validateSession(token);
  if (!user) return { success:false, message:'กรุณาเข้าสู่ระบบใหม่' };
  if (!canViewCostModule(user)) return { success:false, message:'ไม่มีสิทธิ์แก้ไขข้อมูลต้นทุน' };
  ensureCostSheets();
  var range = getCostMonthRange(yearMonth);
  var now = formatDate(new Date());
  var updated = 0;

  var sheet = getSheet('CostPLConfig');
  var headers = getHeaders(sheet);
  var pCol = headers.indexOf('ProductCode'), iCol = headers.indexOf('ItemCode'), yCol = headers.indexOf('YearMonth');
  var data = sheet.getDataRange().getValues();

  (rows || []).forEach(function(r){
    var productCode = String((r && r.productCode) || '').trim();
    var lines = (r && r.lines) || [];
    if (!productCode) return;
    lines.forEach(function(line){
      var code = String(line.code || '').trim();
      var meta = COST_ITEMS.filter(function(it){ return it.code === code; })[0];
      if (!meta || !meta.editable || meta.hidden) return;
      var amount = Number(line.amount) || 0;
      var payload = { ProductCode: productCode, ItemCode: code, YearMonth: range.yearMonth, Amount: amount, UpdatedAt: now, UpdatedBy: user.employeeId };

      var foundRow = -1;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][pCol]) === productCode && String(data[i][iCol]) === code && String(data[i][yCol]) === range.yearMonth) {
          foundRow = i;
          break;
        }
      }
      if (foundRow > -1) {
        var rowValues = headers.map(function(h){ return payload[h] !== undefined ? payload[h] : data[foundRow][headers.indexOf(h)]; });
        sheet.getRange(foundRow + 1, 1, 1, headers.length).setValues([rowValues]);
        data[foundRow] = rowValues;
      } else {
        appendRow('CostPLConfig', payload);
        data.push(headers.map(function(h){ return payload[h] !== undefined ? payload[h] : ''; }));
      }
      updated++;
    });
  });
  return { success:true, updated: updated, yearMonth: range.yearMonth, message:'บันทึกต้นทุน P&L แล้ว' };
}

// Monthly trend + product comparison for the cost dashboard.
// params: { yearMonth: 'YYYY-MM' (last month in range), months: number of months back (default 6, max 24) }
function getCostDashboard(token, params) {
  var user = validateSession(token);
  if (!user) return { success:false, message:'กรุณาเข้าสู่ระบบใหม่' };
  if (!canViewCostModule(user)) return { success:false, message:'ไม่มีสิทธิ์เข้าถึงข้อมูลต้นทุน' };
  ensureCostSheets();

  params = params || {};
  var toYearMonth = getCostMonthRange(params.yearMonth).yearMonth;
  var monthsCount = Math.max(1, Math.min(24, Number(params.months) || 6));
  var y = Number(toYearMonth.substring(0, 4));
  var m = Number(toYearMonth.substring(5, 7));

  var months = [];
  for (var i = monthsCount - 1; i >= 0; i--) {
    var d = new Date(y, m - 1 - i, 1);
    months.push(Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM'));
  }

  var items = getCostItems();
  var trend = [];
  var productBreakdown = [];

  months.forEach(function(ym, idx){
    var range = getCostMonthRange(ym);
    var products = getCostProducts(range.from, range.to);
    var byProduct = getCostConfigByMonth(ym);
    var matrix = computeCostMatrix(products, byProduct);

    // Company-wide totals = sum of each product's computed line values.
    // Safe because every formula in COST_ITEMS is a linear combination (+/-) of per-product amounts.
    var totals = {};
    matrix.forEach(function(p){
      items.forEach(function(it){ totals[it.code] = (totals[it.code] || 0) + (Number(p.values[it.code]) || 0); });
    });

    trend.push({
      yearMonth: ym,
      sale: totals.SALE || 0,
      rm: totals.RM || 0,
      subcon: totals.SUBCON || 0,
      dlsum: totals.DLSUM || 0,
      otsum: totals.OTSUM || 0,
      ohvc: totals.OHVC || 0,
      ohfc: totals.OHFC || 0,
      cogs: totals.COGS || 0,
      gp: totals.GP || 0,
      sga: totals.SGA || 0,
      profit: totals.PROFIT || 0,
      ebit: totals.EBIT || 0,
      eat: totals.EAT || 0,
      gpPercent: totals.SALE ? (totals.GP / totals.SALE * 100) : 0
    });

    if (idx === months.length - 1) {
      productBreakdown = matrix.map(function(p){
        return { productCode: p.productCode, productName: p.productName, sale: p.values.SALE || 0, gp: p.values.GP || 0, profit: p.values.PROFIT || 0, eat: p.values.EAT || 0 };
      }).sort(function(a,b){ return b.sale - a.sale; });
    }
  });

  var current = trend[trend.length - 1] || null;
  var previous = trend.length > 1 ? trend[trend.length - 2] : null;
  var mom = null;
  if (current && previous) {
    var pctChange = function(cur, prev) { return prev ? ((cur - prev) / Math.abs(prev) * 100) : (cur ? 100 : 0); };
    mom = {
      sale: pctChange(current.sale, previous.sale),
      gp: pctChange(current.gp, previous.gp),
      profit: pctChange(current.profit, previous.profit),
      eat: pctChange(current.eat, previous.eat)
    };
  }

  return { success: true, yearMonth: toYearMonth, months: months, trend: trend, productBreakdown: productBreakdown, mom: mom };
}
