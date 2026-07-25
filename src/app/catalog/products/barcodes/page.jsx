"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const CODE128_PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

const BARCODE_LABEL_WIDTH_MM = 50;
const BARCODE_LABEL_HEIGHT_MM = 25;
const BARCODE_IMAGE_WIDTH_MM = 38;
const BARCODE_IMAGE_HEIGHT_MM = 10;

function code128Values(text) {
  const safe = String(text || "").replace(/[^\x20-\x7f]/g, "");
  const values = [104];
  for (const char of safe) values.push(char.charCodeAt(0) - 32);
  const checksum =
    values.reduce(
      (sum, value, index) => sum + value * (index === 0 ? 1 : index),
      0,
    ) % 103;
  values.push(checksum, 106);
  return values;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getPrintErrorMessage(err) {
  const message = String(err?.message || "");
  if (
    /printer queue|not installed|installed printers|windows|cups/i.test(message)
  ) {
    return "TSC TTP-244 Pro printer queue is not ready. Install the TSC TTP-244 Pro driver in Windows Printers & scanners, confirm it appears as a printer, then click Print again.";
  }
  return message || "Unable to open barcode print window.";
}

function barcodeSvgMarkup(value) {
  const bars = [];
  let x = 0;
  for (const code of code128Values(value)) {
    const pattern = CODE128_PATTERNS[code];
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }

  return `
    <svg viewBox="0 0 ${x} 46" preserveAspectRatio="xMidYMid meet" class="barcode-svg">
      <rect width="${x}" height="46" fill="white"></rect>
      ${bars
        .map(
          (bar) =>
            `<rect x="${bar.x}" y="0" width="${bar.width}" height="46" fill="black"></rect>`,
        )
        .join("")}
    </svg>
  `;
}

function browserLabelMarkup(product) {
  const price = Number(product.selling_price || product.mrp || 0);
  const expiryDate = formatExpiryDate(product.expiry_date);
  const meta =
    [product.brand_name, product.unit].filter(Boolean).join(" | ") || "Product";
  const code = product.barcode || product.sku || product.product_id || "";

  return `
    <section class="label">
      <div class="top">
        <div class="name-block">
          <div class="name">${escapeHtml(product.name)}</div>
          <div class="meta">${escapeHtml(meta)}</div>
        </div>
        <div class="price-block">
          <div class="price">${escapeHtml(money(price))}</div>
          <div class="expiry">${expiryDate ? `Exp ${escapeHtml(expiryDate)}` : ""}</div>
        </div>
      </div>
      <div class="barcode">${barcodeSvgMarkup(code)}</div>
      <div class="code">${escapeHtml(code)}</div>
    </section>
  `;
}

// NOTE: this no longer wraps rows in anything that triggers a page break.
// Every label is just a grid cell inside ONE continuous page. The physical
// printer's own gap sensor is what divides the continuous strip into
// individual labels as it feeds — the browser must not try to "paginate"
// on top of that, or the two feed mechanisms fight each other and content
// drifts/bleeds across label boundaries (the bug you saw in the photo).
function browserLabelsMarkup(labels) {
  return labels.map(({ product }) => browserLabelMarkup(product)).join("");
}

function printWithBrowserDialog(labels) {
  const printWindow = window.open("", "_blank", "popup,width=900,height=420");
  if (!printWindow) {
    throw new Error("Popup blocked. Please allow popups to print barcodes.");
  }

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Barcode Labels</title>
        <style>
          @page {
            size: ${BARCODE_LABEL_WIDTH_MM}mm ${BARCODE_LABEL_HEIGHT_MM}mm;
            margin: 0;
          }
          * { box-sizing: border-box; }
          html, body {
            width: ${BARCODE_LABEL_WIDTH_MM}mm;
            min-height: ${BARCODE_LABEL_HEIGHT_MM}mm;
            margin: 0;
            padding: 0;
            background: white;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #000;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* One single continuous grid for ALL labels — no per-row
             container, no forced page breaks. This is what stops the
             browser from re-paginating mid-sheet and fighting the
             printer's own gap sensor. */
          .label-grid {
            width: ${BARCODE_LABEL_WIDTH_MM}mm;
            margin: 0;
            padding: 0;
          }
          .label {
            width: ${BARCODE_LABEL_WIDTH_MM}mm;
            height: ${BARCODE_LABEL_HEIGHT_MM}mm;
            padding: 0.8mm 1mm;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .label:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .top {
            display: flex;
            justify-content: space-between;
            gap: 1mm;
            height: 5.6mm;
            overflow: hidden;
          }
          .name-block {
            min-width: 0;
            flex: 1 1 auto;
          }
          .name {
            font-size: 7px;
            font-weight: 700;
            line-height: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-transform: uppercase;
          }
          .meta, .expiry {
            font-size: 5px;
            line-height: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .price-block {
            flex: 0 0 auto;
            max-width: 16mm;
            text-align: right;
          }
          .price {
            font-size: 6px;
            font-weight: 700;
            line-height: 1;
            white-space: nowrap;
          }
          .barcode {
            margin-top: 0.5mm;
            display: flex;
            justify-content: center;
          }
          .barcode-svg {
            display: block;
            width: ${BARCODE_IMAGE_WIDTH_MM}mm;
            height: ${BARCODE_IMAGE_HEIGHT_MM}mm;
          }
          .code {
            margin-top: 0.2mm;
            font-size: 5px;
            line-height: 1;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
          }
          @media print {
            html, body {
              width: ${BARCODE_LABEL_WIDTH_MM}mm !important;
              min-height: ${BARCODE_LABEL_HEIGHT_MM}mm !important;
              margin: 0 !important;
              padding: 0 !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="label-grid">
          ${browserLabelsMarkup(labels)}
        </div>
        <script>
          window.onload = function () {
            window.focus();
            setTimeout(function () {
              window.print();
            }, 150);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function buildOfflineBarcodeHtml(labels) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Barcode Labels 50x25</title>
        <style>
          @page {
            size: ${BARCODE_LABEL_WIDTH_MM}mm ${BARCODE_LABEL_HEIGHT_MM}mm;
            margin: 0;
          }
          * { box-sizing: border-box; }
          html, body {
            width: ${BARCODE_LABEL_WIDTH_MM}mm;
            min-height: ${BARCODE_LABEL_HEIGHT_MM}mm;
            margin: 0;
            padding: 0;
            background: white;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #000;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .label-grid {
            width: ${BARCODE_LABEL_WIDTH_MM}mm;
            margin: 0;
            padding: 0;
          }
          .label {
            width: ${BARCODE_LABEL_WIDTH_MM}mm;
            height: ${BARCODE_LABEL_HEIGHT_MM}mm;
            padding: 0.8mm 1mm;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .label:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .top {
            display: flex;
            justify-content: space-between;
            gap: 1mm;
            height: 5.6mm;
            overflow: hidden;
          }
          .name-block {
            min-width: 0;
            flex: 1 1 auto;
          }
          .name {
            font-size: 7px;
            font-weight: 700;
            line-height: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-transform: uppercase;
          }
          .meta, .expiry {
            font-size: 5px;
            line-height: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .price-block {
            flex: 0 0 auto;
            max-width: 16mm;
            text-align: right;
          }
          .price {
            font-size: 6px;
            font-weight: 700;
            line-height: 1;
            white-space: nowrap;
          }
          .barcode {
            margin-top: 0.5mm;
            display: flex;
            justify-content: center;
          }
          .barcode-svg {
            display: block;
            width: ${BARCODE_IMAGE_WIDTH_MM}mm;
            height: ${BARCODE_IMAGE_HEIGHT_MM}mm;
          }
          .code {
            margin-top: 0.2mm;
            font-size: 5px;
            line-height: 1;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
          }
          @media print {
            html, body {
              width: ${BARCODE_LABEL_WIDTH_MM}mm !important;
              min-height: ${BARCODE_LABEL_HEIGHT_MM}mm !important;
              margin: 0 !important;
              padding: 0 !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="label-grid">
          ${browserLabelsMarkup(labels)}
        </div>
      </body>
    </html>
  `;
}

function downloadOfflineBarcodeHtml(labels) {
  const blob = new Blob([buildOfflineBarcodeHtml(labels)], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "barcode-labels-50x25-landscape.html";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function BarcodeSvg({ value }) {
  const bars = [];
  let x = 0;
  for (const code of code128Values(value)) {
    const pattern = CODE128_PATTERNS[code];
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }
  return (
    <svg
      viewBox={`0 0 ${x} 46`}
      preserveAspectRatio="xMidYMid meet"
      className="mx-auto block"
      style={{
        width: `${BARCODE_IMAGE_WIDTH_MM}mm`,
        height: `${BARCODE_IMAGE_HEIGHT_MM}mm`,
      }}
    >
      <rect width={x} height="46" fill="white" />
      {bars.map((bar, index) => (
        <rect
          key={index}
          x={bar.x}
          y="0"
          width={bar.width}
          height="46"
          fill="black"
        />
      ))}
    </svg>
  );
}

function money(value) {
  const num = Number(value || 0);
  return `Rs. ${num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatExpiryDate(value) {
  if (!value) return "";
  const isoDate = String(value).slice(0, 10);
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return isoDate;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getExpiryOptions(product) {
  return Array.isArray(product?.expiry_options) ? product.expiry_options : [];
}

function getExpiryOptionValue(option) {
  return String(option?.expiryDate || option?.expiry_date || "").slice(0, 10);
}

function productNeedsExpirySelection(product) {
  return (
    getExpiryOptions(product).filter((option) => getExpiryOptionValue(option))
      .length > 1
  );
}

function getResolvedProductExpiry(product, selectedExpiryByProduct) {
  return (
    selectedExpiryByProduct[String(product.id)] ||
    product.expiry_date ||
    getExpiryOptionValue(getExpiryOptions(product)[0]) ||
    ""
  );
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function Label({ product, widthMm, heightMm }) {
  const price = Number(product.selling_price || product.mrp || 0);
  const expiryDate = formatExpiryDate(product.expiry_date);
  return (
    <div
      className="barcode-label overflow-hidden border border-dashed border-slate-300 bg-white p-1.5 text-slate-950"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-[8px] font-bold uppercase leading-none">
            {product.name}
          </div>
          <div className="truncate text-[6px] leading-none text-slate-600">
            {[product.brand_name, product.unit].filter(Boolean).join(" | ") ||
              "Product"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[8px] font-bold leading-none">
            {money(price)}
          </div>
          <div className="text-[6px] leading-none text-slate-600">
            {expiryDate ? `Exp: ${expiryDate}` : ""}
          </div>
        </div>
      </div>
      <div className="mt-1">
        <BarcodeSvg value={product.barcode} />
      </div>
      <div className="mt-0.5 flex justify-between gap-1 text-[7px] leading-none text-slate-700">
        <span className="truncate">{product.barcode}</span>
        <span className="truncate">
          {product.sku || product.product_id || ""}
        </span>
      </div>
    </div>
  );
}

export default function ProductBarcodePrintPage() {
  const searchParams = useSearchParams();
  const ids = searchParams.get("ids") || "";
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [selectedExpiryByProduct, setSelectedExpiryByProduct] = useState({});
  const [expiryModalOpen, setExpiryModalOpen] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/catalog/products/barcodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const json = await response.json();
        if (!json.success)
          throw new Error(json.message || "Unable to load barcode labels");
        if (!ignore) {
          const records = json.data?.records || [];
          setProducts(records);
          const initialSelections = {};
          for (const product of records) {
            const options = getExpiryOptions(product);
            if (options.length === 1) {
              initialSelections[String(product.id)] = getExpiryOptionValue(
                options[0],
              );
            } else if (product.expiry_date) {
              initialSelections[String(product.id)] = String(
                product.expiry_date,
              ).slice(0, 10);
            }
          }
          setSelectedExpiryByProduct(initialSelections);
          setExpiryModalOpen(records.some(productNeedsExpirySelection));
        }
      } catch (err) {
        if (!ignore) setError(err.message || "Unable to load barcode labels");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [ids]);

  const productsNeedingExpirySelection = useMemo(
    () => products.filter(productNeedsExpirySelection),
    [products],
  );

  const hasPendingExpirySelection = useMemo(
    () =>
      productsNeedingExpirySelection.some(
        (product) => !selectedExpiryByProduct[String(product.id)],
      ),
    [productsNeedingExpirySelection, selectedExpiryByProduct],
  );

  const resolvedProducts = useMemo(
    () =>
      products.map((product) => ({
        ...product,
        expiry_date: getResolvedProductExpiry(product, selectedExpiryByProduct),
      })),
    [products, selectedExpiryByProduct],
  );

  const labels = useMemo(() => {
    const count = Math.max(1, Math.min(200, Number(copies) || 1));
    return resolvedProducts.flatMap((product) =>
      Array.from({ length: count }, (_, index) => ({
        product,
        key: `${product.id}-${index}`,
      })),
    );
  }, [copies, resolvedProducts]);

  const safeCopies = clampNumber(copies, 1, 200, 1);
  const safeWidthMm = BARCODE_LABEL_WIDTH_MM;
  const safeHeightMm = BARCODE_LABEL_HEIGHT_MM;

  const downloadBarcodeList = async () => {
    if (!resolvedProducts.length) return;
    if (hasPendingExpirySelection) {
      setExpiryModalOpen(true);
      return;
    }
    const XLSX = await import("xlsx");
    const rows = resolvedProducts.map((product, index) => ({
      "S. No.": index + 1,
      "Product Name": product.name || "",
      "Product Code": product.product_id || "",
      SKU: product.sku || "",
      Barcode: product.barcode || "",
      Brand: product.brand_name || "",
      Category: product.category_name || "",
      Unit: product.unit || "",
      "Expiry Date": formatExpiryDate(product.expiry_date),
      MRP: Number(product.mrp || 0),
      "Selling Price": Number(product.selling_price || product.mrp || 0),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Barcodes");
    XLSX.writeFile(workbook, "product-barcodes.xlsx");
  };

  const printLabels = async () => {
    if (!resolvedProducts.length) return;
    if (hasPendingExpirySelection) {
      setExpiryModalOpen(true);
      return;
    }
    setPrinting(true);
    setError("");
    try {
      printWithBrowserDialog(labels);
      setError("");
    } catch (err) {
      setError(getPrintErrorMessage(err));
    } finally {
      setPrinting(false);
    }
  };

  const downloadBarcodeLabels = () => {
    if (!resolvedProducts.length) return;
    if (hasPendingExpirySelection) {
      setExpiryModalOpen(true);
      return;
    }
    downloadOfflineBarcodeHtml(labels);
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-sm text-slate-800">
      <div className="no-print mx-auto mb-4 flex max-w-6xl flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold text-slate-950">
            Barcode Labels
          </h1>
          <p className="text-xs text-slate-500">
            Auto-generated barcodes are saved to product master before printing.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Copies
            </span>
            <input
              type="number"
              min="1"
              max="200"
              value={copies}
              onChange={(e) => setCopies(e.target.value)}
              onBlur={() => setCopies(safeCopies)}
              className="w-20 rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            onClick={downloadBarcodeList}
            disabled={!products.length}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-semibold text-slate-700 disabled:opacity-50"
          >
            Download Excel
          </button>
          <button
            onClick={downloadBarcodeLabels}
            disabled={!resolvedProducts.length}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-semibold text-slate-700 disabled:opacity-50"
          >
            Download Labels
          </button>
          <button
            onClick={printLabels}
            disabled={!resolvedProducts.length || printing}
            className="rounded-lg bg-red-700 px-5 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {printing ? "Printing..." : "Print"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mx-auto max-w-6xl rounded-lg bg-white p-8 text-center text-slate-500">
          Loading labels...
        </div>
      ) : error ? (
        <div className="mx-auto max-w-6xl rounded-lg bg-white p-8 text-center text-red-600">
          {error}
        </div>
      ) : (
        <div className="print-sheet mx-auto flex max-w-6xl flex-wrap content-start gap-2 bg-white p-4 shadow-sm">
          {labels.map(({ product, key }) => (
            <Label
              key={key}
              product={product}
              widthMm={safeWidthMm}
              heightMm={safeHeightMm}
            />
          ))}
        </div>
      )}

      {expiryModalOpen && productsNeedingExpirySelection.length ? (
        <div className="no-print fixed inset-0 z-[999] flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-950">
                Select batch expiry date
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                These products have stock in multiple expiry batches. Choose the
                exact expiry date to print on each barcode label.
              </p>
            </div>

            <div className="space-y-3">
              {productsNeedingExpirySelection.map((product) => (
                <label
                  key={product.id}
                  className="block rounded-lg border border-slate-200 p-3"
                >
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {product.name}
                  </span>
                  <span className="mb-2 block text-xs text-slate-500">
                    {[product.brand_name, product.unit]
                      .filter(Boolean)
                      .join(" | ") || "Product"}
                  </span>
                  <select
                    value={selectedExpiryByProduct[String(product.id)] || ""}
                    onChange={(event) =>
                      setSelectedExpiryByProduct((current) => ({
                        ...current,
                        [String(product.id)]: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select expiry date</option>
                    {getExpiryOptions(product).map((option) => {
                      const value = getExpiryOptionValue(option);
                      return (
                        <option key={value} value={value}>
                          {formatExpiryDate(value)} - Qty{" "}
                          {Number(option.availableQty || 0).toLocaleString(
                            "en-IN",
                            { maximumFractionDigits: 3 },
                          )}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExpiryModalOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={hasPendingExpirySelection}
                onClick={() => setExpiryModalOpen(false)}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
