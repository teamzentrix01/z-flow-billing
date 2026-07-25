"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import CatalogListPage from "@/components/CatalogListPage";

const columns = [
  { key: "sno", label: "S. No.", sortable: true },
  { key: "product_id", label: "Product ID", sortable: true },
  { key: "product_name", label: "Product Name", sortable: true },
  { key: "barcode", label: "Barcode", sortable: true },
  { key: "sku", label: "SKU", sortable: true },
  { key: "safe_stock_level", label: "Safe Stock Level", sortable: true },
  { key: "low_stock_level", label: "Low Stock Level", sortable: true },
  { key: "mrp", label: "M.R.P", sortable: true },
  { key: "franchise_cost", label: "Franchise Cost", sortable: true },
  { key: "selling_price", label: "Selling Price", sortable: true },
  { key: "sell_on_store", label: "Sell on Store", sortable: true },
];

function mapRows(records = []) {
  return records.map((item, index) => ({
    id: item.id,
    sno: index + 1,
    product_id: item.product_id || item.id,
    product_name: item.name,
    barcode: item.barcode || "-",
    sku: item.sku || "-",
    safe_stock_level: item.safe_stock_level ?? 0,
    low_stock_level: item.low_stock_level ?? 0,
    mrp: item.store_mrp ?? item.mrp ?? 0,
    franchise_cost: item.franchise_cost ?? 0,
    selling_price: item.store_selling_price ?? item.selling_price ?? 0,
    sell_on_store: item.is_assigned ? "Yes" : "No",
    is_assigned: Boolean(item.is_assigned),
  }));
}

export default function AssignProductsToStorePage() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [storesList, setStoresList] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [editForm, setEditForm] = useState({
    mrp: "",
    selling_price: "",
    is_assigned: true,
  });
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Bulk Edit States
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkSelected, setBulkSelected] = useState({});
  const [bulkAssignStatus, setBulkAssignStatus] = useState(true);
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/stores");
        const json = await res.json();
        if (json.success)
          setStoresList(json.data.stores || json.data.records || []);
      } catch (e) {
        /* ignore */
      }
    })();
  }, []);

  const handleStoreChange = async (storeId) => {
    setSelectedStoreId(storeId || "");
    setEditingRow(null);
    if (!storeId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/catalog/assign-products-store?storeId=${encodeURIComponent(storeId)}`,
      );
      const json = await res.json();
      setRows(json.success ? mapRows(json.data.records || []) : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (row) => {
    if (!selectedStoreId) return alert("Select a store first");
    setEditingRow(row);
    setEditForm({
      mrp: String(row.mrp ?? ""),
      selling_price: String(row.selling_price ?? ""),
      is_assigned: Boolean(row.is_assigned),
    });
  };

  const handleSaveEdit = async () => {
    if (!editingRow || !selectedStoreId || saving) return;
    const mrp = Number(editForm.mrp);
    const sellingPrice = Number(editForm.selling_price);
    if (
      editForm.is_assigned &&
      (!Number.isFinite(mrp) ||
        !Number.isFinite(sellingPrice) ||
        mrp < 0 ||
        sellingPrice < 0)
    ) {
      return alert("Enter valid MRP and Selling Price");
    }
    setSaving(true);
    const res = await fetch("/api/catalog/assign-products-store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: editingRow.id,
        storeId: selectedStoreId,
        assign: editForm.is_assigned,
        ...(editForm.is_assigned ? { mrp, selling_price: sellingPrice } : {}),
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!json.success)
      return alert(json.message || "Failed to update product assignment");
    setEditingRow(null);
    await handleStoreChange(selectedStoreId);
  };

  const handleBulkCreate = () =>
    router.push("/catalog/pricing/assign-products-store/assignbulk");

  const handleBulkEditClick = () => {
    if (!selectedStoreId) return alert("Select a store first");
    setBulkSelected({});
    setBulkSearch("");
    setBulkAssignStatus(true);
    setShowBulkModal(true);
  };

  const handleSaveBulkEdit = async () => {
    const selectedIds = Object.keys(bulkSelected)
      .map(Number)
      .filter((id) => bulkSelected[id]);
    if (selectedIds.length === 0) {
      return alert("Please select at least one product");
    }
    setBulkSaving(true);
    try {
      const res = await fetch("/api/catalog/assign-products-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          productIds: selectedIds,
          assign: bulkAssignStatus,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.message || "Failed to bulk update product assignments");
      } else {
        setShowBulkModal(false);
        await handleStoreChange(selectedStoreId);
      }
    } catch (e) {
      alert("Failed to save changes. Please try again.");
    } finally {
      setBulkSaving(false);
    }
  };

  const modalFilteredRows = rows.filter((r) => {
    if (!bulkSearch) return true;
    const query = bulkSearch.toLowerCase();
    return (
      String(r.product_name || "")
        .toLowerCase()
        .includes(query) ||
      String(r.sku || "")
        .toLowerCase()
        .includes(query) ||
      String(r.barcode || "")
        .toLowerCase()
        .includes(query) ||
      String(r.product_id || "")
        .toLowerCase()
        .includes(query)
    );
  });

  const isAllBulkSelected =
    modalFilteredRows.length > 0 &&
    modalFilteredRows.every((r) => bulkSelected[r.id]);

  const handleBulkSelectAll = (checked) => {
    const nextSelected = { ...bulkSelected };
    modalFilteredRows.forEach((r) => {
      if (checked) {
        nextSelected[r.id] = true;
      } else {
        delete nextSelected[r.id];
      }
    });
    setBulkSelected(nextSelected);
  };

  const bulkEditModal = showBulkModal ? (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Bulk Edit Product Assignments
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Modify store saleability (Yes/No) in bulk
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowBulkModal(false)}
            className="text-slate-400 hover:text-slate-500 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Action Controls & Search */}
        <div className="bg-slate-50 border-b border-slate-100 px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-700">
              Set "Sell on Store" to:
            </span>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setBulkAssignStatus(true)}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold tracking-wide transition-all ${
                  bulkAssignStatus
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Yes (Sell)
              </button>
              <button
                type="button"
                onClick={() => setBulkAssignStatus(false)}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold tracking-wide transition-all ${
                  !bulkAssignStatus
                    ? "bg-rose-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                No (Don't Sell)
              </button>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              fill="none"
              viewBox="0 0 20 20"
            >
              <circle
                cx="9"
                cy="9"
                r="6"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M15 15l-3-3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="text"
              placeholder="Search products..."
              value={bulkSearch}
              onChange={(e) => setBulkSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Product List Table */}
        <div className="flex-1 overflow-y-auto px-6 py-2 min-h-[200px]">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-slate-600 font-medium">
                <th className="py-3 text-left w-12">
                  <input
                    type="checkbox"
                    checked={isAllBulkSelected}
                    onChange={(e) => handleBulkSelectAll(e.target.checked)}
                    className="w-4 h-4 accent-blue-600 cursor-pointer rounded"
                  />
                </th>
                <th className="py-3 text-left">Product Name</th>
                <th className="py-3 text-left">SKU / Barcode</th>
                <th className="py-3 text-center w-28">Current Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {modalFilteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan="4"
                    className="text-center py-8 text-slate-400 text-sm"
                  >
                    No products found
                  </td>
                </tr>
              ) : (
                modalFilteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="py-3 text-left">
                      <input
                        type="checkbox"
                        checked={!!bulkSelected[row.id]}
                        onChange={(e) =>
                          setBulkSelected((prev) => {
                            const next = { ...prev };
                            if (e.target.checked) next[row.id] = true;
                            else delete next[row.id];
                            return next;
                          })
                        }
                        className="w-4 h-4 accent-blue-600 cursor-pointer rounded"
                      />
                    </td>
                    <td className="py-3 font-medium text-slate-800">
                      {row.product_name}
                    </td>
                    <td className="py-3 text-slate-500 text-xs">
                      {row.sku !== "-" ? row.sku : ""}
                      {row.sku !== "-" && row.barcode !== "-" ? " / " : ""}
                      {row.barcode !== "-" ? row.barcode : ""}
                      {row.sku === "-" && row.barcode === "-" ? "—" : ""}
                    </td>
                    <td className="py-3 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          row.is_assigned
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {row.is_assigned ? "Yes" : "No"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 bg-slate-50 rounded-b-xl">
          <span className="text-xs font-medium text-slate-500">
            {Object.values(bulkSelected).filter(Boolean).length} of{" "}
            {rows.length} product(s) selected
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowBulkModal(false)}
              disabled={bulkSaving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveBulkEdit}
              disabled={bulkSaving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5"
            >
              {bulkSaving ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const editModal = editingRow ? (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Edit Store Pricing
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {editingRow.product_name}
          </p>
        </div>
        <div className="space-y-4 px-5 py-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={editForm.is_assigned}
              onChange={(event) =>
                setEditForm((prev) => ({
                  ...prev,
                  is_assigned: event.target.checked,
                }))
              }
              className="h-4 w-4 accent-blue-600"
            />
            Sell on selected store
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              MRP
              <input
                type="number"
                min="0"
                step="0.01"
                value={editForm.mrp}
                disabled={!editForm.is_assigned}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    mrp: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Selling Price
              <input
                type="number"
                min="0"
                step="0.01"
                value={editForm.selling_price}
                disabled={!editForm.is_assigned}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    selling_price: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
              />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={() => setEditingRow(null)}
            disabled={saving}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveEdit}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <CatalogListPage
        breadcrumbs={[
          { label: "Catalog", href: "/catalog" },
          { label: "Pricing", href: "/catalog/pricing" },
          { label: "Assign products to store" },
        ]}
        title="Assign Product To Store"
        description="Map products to stores and edit store-wise MRP/SP Need Help?"
        createLabel={"Bulk Create"}
        onCreateClick={handleBulkCreate}
        extraHeaderButtons={
          <button
            type="button"
            onClick={handleBulkEditClick}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto"
          >
            Bulk Edit
          </button>
        }
        bulkImportType={"products"}
        onImportSuccess={() => setRows([])}
        bulkOperations={false}
        showStoreSelector={true}
        selectorLabel={null}
        selectorPlaceholder="None"
        stores={storesList}
        onStoreChange={handleStoreChange}
        columns={columns}
        rows={rows}
        loading={loading}
        totalLabel="Product(s)"
        emptyMessage="No Records Found"
        showRowActions={true}
        onEdit={handleEdit}
      />

      {mounted && editModal ? createPortal(editModal, document.body) : null}
      {mounted && bulkEditModal
        ? createPortal(bulkEditModal, document.body)
        : null}
    </>
  );
}
