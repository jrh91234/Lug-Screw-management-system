/**
 * Product and BOM Management Service
 */

function getProducts() {
  var products = getAllRows('Products');
  return products.filter(function(p) {
    return String(p.Active) === 'TRUE' || p.Active === true;
  }).map(function(p) {
    return {
      productCode: p.ProductCode,
      productName: p.ProductName,
      defaultQty: p.DefaultQty || 1300,
      active: p.Active
    };
  });
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
