export interface ThermalReceiptLine {
  name: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface ThermalReceiptPayload {
  invoiceNumber: string;
  issuedAt: string;
  storeName: string;
  storeAddress: string;
  gstin: string;
  lines: ThermalReceiptLine[];
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  paymentMethod: string;
  tendered?: string;
  changeDue?: string;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function buildThermalReceiptHtml(payload: ThermalReceiptPayload): string {
  const rows = payload.lines
    .map(
      (line) => `
      <div class="row">
        <div class="item">${escapeHtml(line.name)}</div>
        <div class="meta">
          <span>${escapeHtml(line.quantity)} x ${escapeHtml(line.unitPrice)}</span>
          <span>${escapeHtml(line.lineTotal)}</span>
        </div>
      </div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @page { size: 80mm auto; margin: 0; }
  body {
    width: 72mm;
    margin: 0 auto;
    padding: 4mm 0;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 11px;
    line-height: 1.35;
    color: #000;
  }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .rule { border-top: 1px dashed #000; margin: 6px 0; }
  .row { margin-bottom: 4px; }
  .meta, .total-row { display: flex; justify-content: space-between; }
  .grand { font-size: 13px; font-weight: 700; margin-top: 4px; }
</style>
</head>
<body>
  <div class="center bold">${escapeHtml(payload.storeName)}</div>
  <div class="center">${escapeHtml(payload.storeAddress)}</div>
  <div class="center">GSTIN: ${escapeHtml(payload.gstin)}</div>
  <div class="rule"></div>
  <div class="meta"><span>Inv: ${escapeHtml(payload.invoiceNumber)}</span><span>${escapeHtml(payload.issuedAt)}</span></div>
  <div class="rule"></div>
  ${rows}
  <div class="rule"></div>
  <div class="total-row"><span>Subtotal</span><span>INR ${escapeHtml(payload.subtotal)}</span></div>
  <div class="total-row"><span>GST (CGST+SGST)</span><span>INR ${escapeHtml(payload.taxTotal)}</span></div>
  <div class="total-row grand"><span>TOTAL</span><span>INR ${escapeHtml(payload.grandTotal)}</span></div>
  ${payload.tendered ? `<div class="total-row"><span>Tendered</span><span>INR ${escapeHtml(payload.tendered)}</span></div>` : ''}
  ${payload.changeDue ? `<div class="total-row"><span>Change</span><span>INR ${escapeHtml(payload.changeDue)}</span></div>` : ''}
  <div class="rule"></div>
  <div class="center">Paid via ${escapeHtml(payload.paymentMethod)} · Thank you</div>
</body>
</html>`;
}
