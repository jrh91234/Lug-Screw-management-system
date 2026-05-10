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

function canViewCostModule(user) { var role = String((user && user.role) || '').toLowerCase(); return role === 'admin' || role === 'supervisor'; }
function ensureCostSheets() {
  var ss = getSpreadsheet();
  createSheetIfNotExists(ss, 'CostPLConfig', ['ProductCode', 'ItemCode', 'Amount', 'UpdatedAt', 'UpdatedBy']);
}
function getCostItems() { return COST_ITEMS.slice().sort(function(a,b){return a.order-b.order;}); }
function evalFormula(formula, map) {
  if (!formula) return null;
  var expr = formula.replace(/[A-Z]+/g, function(k){ return Number(map[k] || 0); });
  if (!/^[0-9+\-*/(). ]+$/.test(expr)) return 0;
  try { return Number(Function('return ' + expr)()) || 0; } catch (e) { return 0; }
}

function getCostProducts() {
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

  getAllRows('ProductionLog').forEach(function(log) {
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

function getCostPL(token) {
  var user = validateSession(token);
  if (!user) return { success:false, message:'กรุณาเข้าสู่ระบบใหม่' };
  if (!canViewCostModule(user)) return { success:false, message:'ไม่มีสิทธิ์เข้าถึงข้อมูลต้นทุน' };
  ensureCostSheets();

  var products = getCostProducts();
  var rows = getAllRows('CostPLConfig');
  var byProduct = {};
  rows.forEach(function(r){
    var p = String(r.ProductCode||''); var c = String(r.ItemCode||'');
    if (!byProduct[p]) byProduct[p] = {};
    byProduct[p][c] = Number(r.Amount) || 0;
  });

  var items = getCostItems();
  var matrix = products.map(function(p){
    var vals = byProduct[p.productCode] || {};
    vals.FG = Number(p.totalFg) || 0;
    items.forEach(function(it){ if (!it.formula && vals[it.code] == null) vals[it.code] = 0; });
    items.forEach(function(it){ if (it.formula) vals[it.code] = evalFormula(it.formula, vals); });
    var sale = Number(vals.SALE) || 0;
    var lines = items.filter(function(it){ return !it.hidden; }).map(function(it){
      var amt = Number(vals[it.code]) || 0;
      var pct = it.percentBase === false ? null : (sale !== 0 ? (amt / sale) * 100 : 0);
      return { code: it.code, label: it.label, group: it.group, editable: it.editable, amount: amt, percent: pct };
    });
    return { productCode: p.productCode, productName: p.productName, source: p.source || 'Products', totalFg: p.totalFg || 0, entries: p.entries || 0, lines: lines };
  });
  return { success: true, items: matrix };
}

function saveCostPL(token, rows) {
  var user = validateSession(token);
  if (!user) return { success:false, message:'กรุณาเข้าสู่ระบบใหม่' };
  if (!canViewCostModule(user)) return { success:false, message:'ไม่มีสิทธิ์แก้ไขข้อมูลต้นทุน' };
  ensureCostSheets();
  var now = formatDate(new Date());
  var updated = 0;
  (rows || []).forEach(function(r){
    var productCode = String((r && r.productCode) || '').trim();
    var lines = (r && r.lines) || [];
    if (!productCode) return;
    lines.forEach(function(line){
      var code = String(line.code || '').trim();
      var meta = COST_ITEMS.filter(function(it){ return it.code === code; })[0];
      if (!meta || !meta.editable || meta.hidden) return;
      var payload = { ProductCode: productCode, ItemCode: code, Amount: Number(line.amount)||0, UpdatedAt: now, UpdatedBy: user.employeeId };
      var key = productCode + '|' + code;
      var found = findRows('CostPLConfig', function(x){ return String(x.ProductCode||'') + '|' + String(x.ItemCode||'') === key; });
      if (found && found.length) {
        // update by compound key via sheet row scan
        var sheet = getSheet('CostPLConfig');
        var data = sheet.getDataRange().getValues();
        var header = data[0];
        for (var i=1;i<data.length;i++) {
          if (String(data[i][0])===productCode && String(data[i][1])===code) {
            sheet.getRange(i+1, 1, 1, 5).setValues([[payload.ProductCode,payload.ItemCode,payload.Amount,payload.UpdatedAt,payload.UpdatedBy]]);
            break;
          }
        }
      } else {
        appendRow('CostPLConfig', payload);
      }
      updated++;
    });
  });
  return { success:true, updated: updated, message:'บันทึกต้นทุน P&L แล้ว' };
}
