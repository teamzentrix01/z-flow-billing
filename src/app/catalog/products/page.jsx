"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CatalogDataPage from "@/components/CatalogDataPage";
import SearchableSelect from "@/components/SearchableSelect";
import { fetchAllCatalogProducts } from "@/lib/productPagination";

const columns = [
  { key: "sno", label: "S. No.", sortable: true },
  { key: "name", label: "Product Name", sortable: true },
  { key: "barcode", label: "Barcode", sortable: true },
  { key: "category", label: "Category", sortable: true },
  { key: "brand", label: "Brand", sortable: true },
  { key: "mrp", label: "MRP", sortable: true },
  { key: "costPrice", label: "Cost Price", sortable: true },
  { key: "sellingPrice", label: "Selling Price", sortable: true },
  { key: "stock", label: "Stock", sortable: true },
];

const UNIT_OPTIONS = ["PCS", "KG", "GRAMS", "LTR"];
const INVENTORY_METHOD_OPTIONS = ["direct", "indirect"];
const STOCK_ITEM_TYPE_OPTIONS = ["unbatched", "batched"];
const BULK_EDIT_HEADERS = [
  "Product ID",
  "Product Name",
  "Barcode",
  "SKU",
  "Brand ID",
  "Brand",
  "Category ID",
  "Category",
  "Department ID",
  "Department",
  "Tax ID",
  "Tax",
  "MRP",
  "Cost Price",
  "Selling Price",
  "Unit",
  "Status",
  "Price Includes Tax",
  "Allow Discount On POS",
  "Inventory Method",
  "Stock Item Type",
];

const initialBulkValues = {
  category_id: "",
  brand_id: "",
  department_id: "",
  tax_id: "",
  mrp: "",
  selling_price: "",
  cost_price: "",
  unit: "PCS",
  is_active: "true",
  allow_discount_on_pos: "false",
  include_tax: "false",
  inventory_method: "direct",
  stock_item_type: "unbatched",
};

const bulkFieldLabels = {
  category_id: "Category",
  brand_id: "Brand",
  department_id: "Department",
  tax_id: "Tax",
  mrp: "MRP",
  selling_price: "Selling Price",
  cost_price: "Cost Price",
  unit: "Unit",
  is_active: "Status",
  allow_discount_on_pos: "Allow Discount On POS",
  include_tax: "Price Includes Tax",
  inventory_method: "Inventory Method",
  stock_item_type: "Stock Item Type",
};

export default function ProductsPage() {
  const [departmentId, setDepartmentId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [departments, setDepartments] = useState([]);
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditSaving, setBulkEditSaving] = useState(false);
  const [bulkEditIds, setBulkEditIds] = useState([]);
  const [bulkEditValues, setBulkEditValues] = useState(initialBulkValues);
  const [bulkEditFields, setBulkEditFields] = useState({});
  const [bulkActionContext, setBulkActionContext] = useState(null);
  const [bulkSheetOpen, setBulkSheetOpen] = useState(false);
  const [bulkSheetBusy, setBulkSheetBusy] = useState(false);
  const [bulkSheetBrandId, setBulkSheetBrandId] = useState("");
  const [bulkSheetRows, setBulkSheetRows] = useState([]);
  const [bulkSheetPreview, setBulkSheetPreview] = useState(null);
  const [bulkSheetNotice, setBulkSheetNotice] = useState(null);
  const bulkSheetFileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [deptRes, brandRes, catRes, taxRes] = await Promise.all([
          fetch("/api/catalog/departments?pageSize=200"),
          fetch("/api/catalog/brands?pageSize=200"),
          fetch("/api/catalog/categories?pageSize=200"),
          fetch("/api/catalog/taxes?pageSize=200"),
        ]);
        const deptJson = await deptRes.json();
        const brandJson = await brandRes.json();
        const catJson = await catRes.json();
        const taxJson = await taxRes.json();
        if (deptJson.success) setDepartments(deptJson.data.records || []);
        if (brandJson.success) setBrands(brandJson.data.records || []);
        if (catJson.success) setCategories(catJson.data.records || []);
        if (taxJson.success) setTaxes(taxJson.data.records || []);
      } catch {
        setDepartments([]);
        setBrands([]);
        setCategories([]);
        setTaxes([]);
      }
    })();
  }, []);

  const filters = useMemo(
    () => (
      <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Department
          </label>
          <SearchableSelect
            value={departmentId}
            onChange={setDepartmentId}
            placeholder="ALL"
            searchPlaceholder="Search department..."
            options={departments.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Brand
          </label>
          <SearchableSelect
            value={brandId}
            onChange={setBrandId}
            placeholder="ALL"
            searchPlaceholder="Search brand..."
            options={brands.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Category
          </label>
          <SearchableSelect
            value={categoryId}
            onChange={setCategoryId}
            placeholder="ALL"
            searchPlaceholder="Search category..."
            options={categories.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        </div>
      </div>
    ),
    [brandId, brands, categoryId, categories, departmentId, departments],
  );

  const resetBulkEdit = () => {
    setBulkEditValues(initialBulkValues);
    setBulkEditFields({});
  };

  const openBulkEdit = ({ selectedIds, showToast, refresh }) => {
    setBulkEditIds(selectedIds);
    setBulkActionContext({ showToast, refresh });
    setBulkSheetOpen(true);
    setBulkSheetBrandId("");
    setBulkSheetRows([]);
    setBulkSheetPreview(null);
    setBulkSheetNotice(null);
  };

  const mapProductToBulkEditRow = (product) => ({
    "Product ID": product.id || "",
    "Product Name": product.name || "",
    Barcode: product.barcode || "",
    SKU: product.sku || "",
    "Brand ID": product.brand_id || "",
    Brand: product.brand_name || "",
    "Category ID": product.category_id || "",
    Category: product.category_name || "",
    "Department ID": product.department_id || "",
    Department: product.department_name || "",
    "Tax ID": product.tax_id || "",
    Tax: product.tax_name || "",
    MRP: product.mrp ?? 0,
    "Cost Price": product.cost_price ?? 0,
    "Selling Price": product.selling_price ?? product.mrp ?? 0,
    Unit: product.unit || "PCS",
    Status: product.is_active === false ? "Inactive" : "Active",
    "Price Includes Tax": product.include_tax ? "Yes" : "No",
    "Allow Discount On POS": product.allow_discount_on_pos ? "Yes" : "No",
    "Inventory Method": product.inventory_method || "direct",
    "Stock Item Type": product.stock_item_type || "unbatched",
  });

  const downloadBulkEditSheet = async ({ brandOnly = false } = {}) => {
    if (brandOnly && !bulkSheetBrandId) {
      bulkActionContext?.showToast?.("Select a brand first", "error");
      return;
    }

    setBulkSheetBusy(true);
    try {
      const products = await fetchAllCatalogProducts({
        pageSize: 1000,
        params: {
          brand_id: brandOnly ? bulkSheetBrandId : "",
        },
        fetchOptions: { cache: "no-store" },
      });
      if (!products.length) {
        bulkActionContext?.showToast?.(
          "No products found to download",
          "error",
        );
        return;
      }

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(
        products.map(mapProductToBulkEditRow),
        { header: BULK_EDIT_HEADERS },
      );
      worksheet["!cols"] = BULK_EDIT_HEADERS.map((header) => ({
        wch:
          header === "Product Name"
            ? 34
            : ["Barcode", "SKU"].includes(header)
              ? 18
              : Math.max(12, Math.min(24, header.length + 2)),
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Product Master");
      const selectedBrand = brands.find(
        (brand) => String(brand.id) === String(bulkSheetBrandId),
      );
      const suffix =
        brandOnly && selectedBrand?.name
          ? selectedBrand.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
          : "full";
      XLSX.writeFile(
        workbook,
        `product-master-bulk-edit-${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      bulkActionContext?.showToast?.("Bulk edit sheet downloaded");
    } catch (err) {
      bulkActionContext?.showToast?.(
        err.message || "Failed to download bulk edit sheet",
        "error",
      );
    } finally {
      setBulkSheetBusy(false);
    }
  };

  const uploadBulkEditSheet = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBulkSheetBusy(true);
    setBulkSheetRows([]);
    setBulkSheetPreview(null);
    setBulkSheetNotice(null);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheet];
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        defval: "",
        raw: false,
      });
      if (!rows.length) {
        setBulkSheetNotice({
          type: "error",
          message: "Uploaded sheet has no product rows",
        });
        return;
      }

      const response = await fetch("/api/catalog/products/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, preview: true }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) {
        setBulkSheetNotice({
          type: "error",
          message:
            json.message || json.error || "Failed to read bulk edit sheet",
        });
        return;
      }

      const data = json.data || {};
      setBulkSheetRows(rows);
      setBulkSheetPreview(data);
      setBulkSheetNotice({
        type: data.skipped ? "warning" : "success",
        message: `Review ready: ${data.changed || 0} changed, ${data.unchanged || 0} unchanged, ${data.skipped || 0} skipped.`,
      });
    } catch (err) {
      setBulkSheetNotice({
        type: "error",
        message: err.message || "Failed to upload bulk edit sheet",
      });
    } finally {
      setBulkSheetBusy(false);
    }
  };

  const confirmBulkEditUpload = async () => {
    if (!bulkSheetRows.length) return;
    setBulkSheetBusy(true);
    setBulkSheetNotice(null);
    try {
      const response = await fetch("/api/catalog/products/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: bulkSheetRows }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.success) {
        setBulkSheetNotice({
          type: "error",
          message:
            json.message || json.error || "Failed to update product master",
        });
        return;
      }

      const data = json.data || {};
      setBulkSheetPreview(data);
      setBulkSheetRows([]);
      bulkActionContext?.refresh?.();
      bulkActionContext?.showToast?.(
        `Product master updated successfully: ${data.updated || 0} updated, ${data.unchanged || 0} unchanged, ${data.skipped || 0} skipped.`,
      );
      closeBulkSheet();
    } catch (err) {
      setBulkSheetNotice({
        type: "error",
        message: err.message || "Failed to update product master",
      });
    } finally {
      setBulkSheetBusy(false);
    }
  };

  const closeBulkSheet = () => {
    setBulkSheetOpen(false);
    setBulkSheetRows([]);
    setBulkSheetPreview(null);
    setBulkSheetNotice(null);
  };

  const closeBulkReview = () => {
    setBulkSheetRows([]);
    setBulkSheetPreview(null);
    setBulkSheetNotice(null);
  };

  const setBulkField = (key, value) => {
    setBulkEditValues((prev) => ({ ...prev, [key]: value }));
  };

  const toggleBulkField = (key) => {
    setBulkEditFields((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleBulkEditSave = async () => {
    const updates = {};
    Object.entries(bulkEditFields).forEach(([key, enabled]) => {
      if (!enabled) return;
      const value = bulkEditValues[key];
      updates[key] =
        key === "is_active" ||
        key === "allow_discount_on_pos" ||
        key === "include_tax"
          ? value === "true"
          : value;
    });

    if (!Object.keys(updates).length) {
      bulkActionContext?.showToast?.(
        "Choose at least one field to update",
        "error",
      );
      return;
    }

    setBulkEditSaving(true);
    try {
      const response = await fetch("/api/catalog/products/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: bulkEditIds, updates }),
      });
      const json = await response.json();

      if (!json.success) {
        bulkActionContext?.showToast?.(
          json.message || "Failed to update selected products",
          "error",
        );
        return;
      }

      setBulkEditOpen(false);
      resetBulkEdit();
      bulkActionContext?.showToast?.(json.message || "Products updated");
      bulkActionContext?.refresh?.();
    } catch {
      bulkActionContext?.showToast?.(
        "Failed to update selected products",
        "error",
      );
    } finally {
      setBulkEditSaving(false);
    }
  };

  const renderBulkSelect = (key, options, placeholder) => (
    <div className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-center">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={!!bulkEditFields[key]}
          onChange={() => toggleBulkField(key)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        {bulkFieldLabels[key]}
      </label>
      <SearchableSelect
        value={bulkEditValues[key]}
        onChange={(value) => setBulkField(key, value)}
        placeholder={placeholder}
        searchPlaceholder={`Search ${bulkFieldLabels[key].toLowerCase()}...`}
        disabled={!bulkEditFields[key]}
        options={options.map((item) => ({
          value: item.id,
          label: item.name,
        }))}
      />
    </div>
  );

  const renderBulkInput = (key, type = "text") => (
    <div className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-center">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={!!bulkEditFields[key]}
          onChange={() => toggleBulkField(key)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        {bulkFieldLabels[key]}
      </label>
      <input
        type={type}
        value={bulkEditValues[key]}
        onChange={(event) => setBulkField(key, event.target.value)}
        disabled={!bulkEditFields[key]}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "0.01" : undefined}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
      />
    </div>
  );

  const renderBulkNativeSelect = (key, options) => (
    <div className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-center">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={!!bulkEditFields[key]}
          onChange={() => toggleBulkField(key)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        {bulkFieldLabels[key]}
      </label>
      <select
        value={bulkEditValues[key]}
        onChange={(event) => setBulkField(key, event.target.value)}
        disabled={!bulkEditFields[key]}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      {bulkEditOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Bulk Edit Products
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Updating {bulkEditIds.length} selected product(s). Only checked
                fields will be changed.
              </p>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
              {renderBulkSelect(
                "department_id",
                departments,
                "No change / Clear",
              )}
              {renderBulkSelect("category_id", categories, "No change / Clear")}
              {renderBulkSelect("brand_id", brands, "No change / Clear")}
              {renderBulkSelect("tax_id", taxes, "No change / Clear")}
              {renderBulkInput("mrp", "number")}
              {renderBulkInput("selling_price", "number")}
              {renderBulkInput("cost_price", "number")}
              {renderBulkNativeSelect(
                "unit",
                UNIT_OPTIONS.map((value) => ({ value, label: value })),
              )}
              {renderBulkNativeSelect("is_active", [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ])}
              {renderBulkNativeSelect("allow_discount_on_pos", [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ])}
              {renderBulkNativeSelect("include_tax", [
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ])}
              {renderBulkNativeSelect(
                "inventory_method",
                INVENTORY_METHOD_OPTIONS.map((value) => ({
                  value,
                  label: value,
                })),
              )}
              {renderBulkNativeSelect(
                "stock_item_type",
                STOCK_ITEM_TYPE_OPTIONS.map((value) => ({
                  value,
                  label: value,
                })),
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkEditSave}
                disabled={bulkEditSaving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bulkEditSaving ? "Updating..." : "Update Selected"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkSheetOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[999] flex items-center justify-center overflow-y-auto bg-slate-950/55 px-4 py-6 sm:py-8">
            <div className="flex max-h-[min(92vh,820px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl">
              <div className="shrink-0 border-b border-gray-100 bg-white px-5 py-4 sm:px-6">
                <h2 className="text-lg font-semibold text-gray-900">
                  Bulk Edit Product Master
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Download products, edit the Excel, then upload it here. Only
                  matched and changed products will be updated.
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
                {bulkSheetNotice && (
                  <div
                    className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                      bulkSheetNotice.type === "success"
                        ? "border-green-200 bg-green-50 text-green-800"
                        : bulkSheetNotice.type === "warning"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-red-200 bg-red-50 text-red-800"
                    }`}
                  >
                    {bulkSheetNotice.message}
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <h3 className="text-sm font-bold text-slate-900">
                    Download edit sheet
                  </h3>
                  <div className="mt-3 grid gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        downloadBulkEditSheet({ brandOnly: false })
                      }
                      disabled={bulkSheetBusy}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Download full product master
                    </button>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <SearchableSelect
                        value={bulkSheetBrandId}
                        onChange={setBulkSheetBrandId}
                        placeholder="Select brand"
                        searchPlaceholder="Search brand..."
                        options={brands.map((brand) => ({
                          value: brand.id,
                          label: brand.name,
                        }))}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          downloadBulkEditSheet({ brandOnly: true })
                        }
                        disabled={bulkSheetBusy}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        Brand Excel
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <h3 className="text-sm font-bold text-slate-900">
                    Upload edited sheet
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Product ID is preferred for matching. Barcode or SKU will be
                    used as fallback.
                  </p>
                  <input
                    ref={bulkSheetFileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={uploadBulkEditSheet}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => bulkSheetFileRef.current?.click()}
                    disabled={bulkSheetBusy}
                    className="mt-3 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {bulkSheetBusy ? "Processing..." : "Upload Edited Excel"}
                  </button>
                </div>
              </div>

              <div className="shrink-0 border-t border-gray-100 bg-white px-5 py-3 sm:px-6">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeBulkSheet}
                    disabled={bulkSheetBusy}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {bulkSheetPreview &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/65 px-4 py-6 sm:py-8">
            <div className="flex max-h-[min(90vh,820px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl">
              <div className="shrink-0 border-b border-slate-100 bg-white px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      Review Uploaded Sheet
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Check edited, non-edited, and warning rows before updating
                      product master.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeBulkReview}
                    disabled={bulkSheetBusy}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
                {bulkSheetNotice && (
                  <div
                    className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${
                      bulkSheetNotice.type === "success"
                        ? "border-green-200 bg-green-50 text-green-800"
                        : bulkSheetNotice.type === "warning"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-red-200 bg-red-50 text-red-800"
                    }`}
                  >
                    {bulkSheetNotice.message}
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                    <p className="text-xs font-medium text-green-700">Edited</p>
                    <p className="text-2xl font-bold text-green-900">
                      {bulkSheetPreview.changed ||
                        bulkSheetPreview.updated ||
                        0}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-medium text-slate-600">
                      Non-edited
                    </p>
                    <p className="text-2xl font-bold text-slate-900">
                      {bulkSheetPreview.unchanged || 0}
                    </p>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-xs font-medium text-red-700">
                      Warning / skipped
                    </p>
                    <p className="text-2xl font-bold text-red-900">
                      {bulkSheetPreview.skipped || 0}
                    </p>
                  </div>
                </div>

                <div className="mt-4 max-h-[48vh] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  {(bulkSheetPreview.rows || []).slice(0, 120).map((row) => (
                    <div
                      key={`${row.row}-${row.productId || row.barcode}`}
                      className={`rounded-xl border px-3 py-2 ${
                        row.status === "changed" || row.status === "updated"
                          ? "border-green-200 bg-green-50/80"
                          : row.status === "skipped"
                            ? "border-red-200 bg-red-50/80"
                            : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            Row {row.row}: {row.productName || "-"}
                          </p>
                          <p className="text-xs text-slate-500">
                            Barcode/SKU: {row.barcode || "-"}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${
                            row.status === "changed" || row.status === "updated"
                              ? "bg-green-100 text-green-700"
                              : row.status === "skipped"
                                ? "bg-red-100 text-red-700"
                                : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {row.status === "updated"
                            ? "Updated"
                            : row.status === "changed"
                              ? "Edited"
                              : row.status === "skipped"
                                ? "Warning"
                                : "Non-edited"}
                        </span>
                      </div>
                      {row.error && (
                        <p className="mt-2 text-xs font-medium text-red-700">
                          {row.error}
                        </p>
                      )}
                      {row.changes?.length > 0 && (
                        <div className="mt-2 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
                          {row.changes.slice(0, 6).map((change) => (
                            <p key={`${row.row}-${change.field}`}>
                              <span className="font-semibold">
                                {change.label}:
                              </span>{" "}
                              {String(change.from)} -&gt; {String(change.to)}
                            </p>
                          ))}
                          {row.changes.length > 6 && (
                            <p className="font-medium text-slate-500">
                              +{row.changes.length - 6} more changes
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {(bulkSheetPreview.rows || []).length > 120 && (
                    <p className="text-center text-xs text-slate-500">
                      Showing first 120 rows. Confirm will process all rows.
                    </p>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-3 sm:px-6">
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeBulkReview}
                    disabled={bulkSheetBusy}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  {bulkSheetRows.length > 0 && (
                    <button
                      type="button"
                      onClick={confirmBulkEditUpload}
                      disabled={
                        bulkSheetBusy || !(bulkSheetPreview.changed > 0)
                      }
                      className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {bulkSheetBusy ? "Updating..." : "Confirm Update"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <CatalogDataPage
        endpoint="/api/catalog/products"
        breadcrumbs={[
          { label: "Catalog", href: "/catalog" },
          { label: "Product", href: "/catalog/products" },
          { label: "Products" },
        ]}
        title="Products"
        description="Manage all products in your catalog."
        columns={columns}
        filters={filters}
        createLabel="Create Product"
        onCreateClick={() =>
          (window.location.href = "/catalog/products/create")
        }
        showRowActions={true}
        onEdit={(row) =>
          (window.location.href = `/catalog/products/${row.id}/edit`)
        }
        onDelete={(row) => {
          /* delete handled by CatalogDataPage */
        }}
        totalLabel="Product(s)"
        emptyMessage="No products found"
        bulkImportType="products"
        customBulkActions={[
          {
            label: "Bulk Edit Selected",
            action: openBulkEdit,
          },
          {
            label: "View / Download Barcodes",
            action: ({ selectedIds, showToast }) => {
              if (!selectedIds.length) {
                showToast(
                  "Select products to view or download barcodes",
                  "error",
                );
                return;
              }
              window.open(
                `/catalog/products/barcodes?ids=${selectedIds.join(",")}`,
                "_blank",
              );
            },
          },
        ]}
        extraQueryParams={{
          department_id: departmentId,
          brand_id: brandId,
          category_id: categoryId,
        }}
        mapRecord={(record, index, page, pageSize) => ({
          id: record.id,
          sno: (page - 1) * pageSize + index + 1,
          name: record.name,
          barcode: record.barcode || "—",
          category: record.category_name || "—",
          brand: record.brand_name || "—",
          mrp: `₹${record.mrp ?? 0}`,
          costPrice: `₹${record.cost_price ?? 0}`,
          sellingPrice: `₹${record.selling_price ?? record.mrp ?? 0}`,
          stock: record.actual_stock ?? "—",
        })}
      />
    </>
  );
}
