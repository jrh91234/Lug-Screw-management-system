/**
 * Product and BOM Management Service
 */

function getProducts() {
  var products = getAllRows('Products');
  return products.filter(function(p) {
    return isActiveValue(p.Active);
  }).map(function(p) {
    return {
      productCode: p.ProductCode,
      productName: p.ProductName,
      defaultQty: p.DefaultQty || 1300,
      active: p.Active,
      unitPrice: Number(p.UnitPrice) || 0
    };
  });
}

// Master unit price per product (not tied to a month). Upserts: if the product
// isn't in the Products sheet yet (e.g. it only exists via ProductionLog), a new
// row is created for it. Uses the same admin/supervisor gate as the rest of the
// cost module (see CostService.canViewCostModule).
function updateProductUnitPrice(token, productCode, unitPrice) {
  var user = validateSession(token);
  if (!user) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
  if (!canViewCostModule(user)) return { success: false, message: 'ไม่มีสิทธิ์แก้ไขราคาต่อหน่วย' };

  productCode = String(productCode || '').trim();
  if (!productCode) return { success: false, message: 'กรุณาระบุรหัสสินค้า' };
  var price = Number(unitPrice);
  if (isNaN(price) || price < 0) return { success: false, message: 'กรุณากรอกราคาต่อหน่วยที่ถูกต้อง' };

  ensureColumnExists('Products', 'UnitPrice'); // self-heal sheets created before this column existed
  var existing = findRow('Products', 'ProductCode', productCode);
  if (existing) {
    updateRow('Products', 'ProductCode', productCode, { UnitPrice: price });
  } else {
    appendRow('Products', { ProductCode: productCode, ProductName: productCode, DefaultQty: 1300, Active: true, UnitPrice: price });
  }
  return { success: true, message: 'บันทึกราคาต่อหน่วยสำเร็จ' };
}

function getProductBOM(productCode) {
  var components = findRows('BOM', function(row) {
    return row.ProductCode === productCode;
  });

  return components.map(function(c) {
    return {
      productCode: c.ProductCode,
      componentCode: c.ComponentCode,
      componentName: c.ComponentName,
      qtyPerUnit: c.QtyPerUnit,
      supplier: c.Supplier
    };
  });
}

function getProductWithBOM(productCode) {
  var product = findRow('Products', 'ProductCode', productCode);
  if (!product) return null;

  var bom = getProductBOM(productCode);

  return {
    productCode: product.ProductCode,
    productName: product.ProductName,
    defaultQty: product.DefaultQty || 1300,
    bom: bom
  };
}

function getAllProductsWithBOM() {
  var products = getProducts();
  return products.map(function(p) {
    p.bom = getProductBOM(p.productCode);
    return p;
  });
}
