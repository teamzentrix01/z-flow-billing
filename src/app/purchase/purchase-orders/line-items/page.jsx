'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MainLayout from '@/components/MainLayout';
import { toDateInputValue } from '@/lib/dateUtils';

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayText(value) {
  const text = String(value ?? '').trim();
  if (!text || text.includes('â') || text.includes('Ã')) return '-';
  return text;
}

function LineItemsContent() {
  const search = useSearchParams();
  const router = useRouter();
  const id = search.get('id');

  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [cartFilter, setCartFilter] = useState('');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [form, setForm] = useState({
    destination: '',
    vendor: '',
    invoice_date: '',
    expected_delivery_date: '',
    shipment_mode: '',
    invoice_number: '',
    cc_emails: '',
  });
  const [confirming, setConfirming] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const isSuperAdmin = currentUser?.role === 'super_admin';

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => setCurrentUser(json.data?.user || json.user || null))
      .catch(() => setCurrentUser(null));
  }, []);

  const userPermissions = Array.isArray(currentUser?.permissions) ? currentUser.permissions : [];
  const canManage = isSuperAdmin || userPermissions.includes('*') || userPermissions.includes('MANAGE_PURCHASE_ORDERS');
  const readOnly = !canManage;

  useEffect(() => {
    if (!id) return;

    fetch(`/api/purchase-orders/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => {
        setDraft(d);
        if (d && !d.error) {
          setForm({
            destination: d.destination || '',
            vendor: d.vendor || '',
            invoice_date: toDateInputValue(d.invoice_date || d.invoiceDate),
            expected_delivery_date: toDateInputValue(d.expected_delivery_date || d.expectedDeliveryDate),
            shipment_mode: d.shipment_mode || d.shipmentMode || '',
            invoice_number: d.invoice_number || d.invoiceNumber || '',
            cc_emails: d.cc_emails || d.ccEmails || '',
          });
          if (Array.isArray(d.items) && d.items.length) {
            setCart(d.items.map((item) => ({
              product_id: item.product_id,
              name: item.name,
              sku: item.sku,
              barcode: item.barcode,
              available_qty: Number(item.available_qty ?? item.availableQty ?? 0),
              cost_price: Number(item.cost_price || 0),
              tax_value: Number(item.tax_value || 0),
              qty: Number(item.qty || 1),
            })));
          }
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const storeId = form.destination || draft?.destination || '';
      if (!storeId) {
        setProducts([]);
        return;
      }
      const q = searchTerm.trim();
      const params = new URLSearchParams({ all: 'true', includeAllProducts: 'true' });
      if (q) params.set('search', q);
      if (storeId) params.set('store_id', storeId);
      fetch(`/api/catalog/products?${params.toString()}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((res) => {
          const records = res?.data?.records ?? res?.records ?? [];
          setProducts(records);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setProducts([]);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm, form.destination, draft?.destination]);

  const filteredCart = useMemo(() => {
    if (!cartFilter.trim()) return cart;
    const q = cartFilter.toLowerCase();
    return cart.filter((item) => (item.name || '').toLowerCase().includes(q));
  }, [cart, cartFilter]);

  const totals = useMemo(() => {
    let totalItems = 0;
    let totalCost = 0;
    let totalTax = 0;

    for (const item of cart) {
      const qty = Number(item.qty || 0);
      const cost = Number(item.cost_price || 0);
      totalItems += qty;
      totalCost += qty * cost;
      totalTax += Number(item.tax_value || 0) * qty;
    }

    return { totalItems, totalCost, totalTax };
  }, [cart]);

  const addToCart = (product) => {
    const productId = product.id ?? product.product_id;
    setCart((current) => {
      const existing = current.find((item) => String(item.product_id) === String(productId));
      if (existing) {
        return current.map((item) =>
          String(item.product_id) === String(productId)
            ? { ...item, qty: Number(item.qty) + 1 }
            : item
        );
      }

      const cost = Number(product.cost_price || 0);
      const taxRate = Number(product.tax_rate || 0);
      const availableQty = Number(product.availableQty ?? product.availableStock ?? product.available_qty ?? product.actual_stock ?? product.stock ?? 0);
      return [
        ...current,
        {
          product_id: productId,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          available_qty: availableQty,
          cost_price: cost,
          tax_value: (cost * taxRate) / 100,
          qty: 1,
        },
      ];
    });
    setSearchTerm('');
    setProducts([]);
  };

  const updateQty = (productId, qty) => {
    setCart((current) =>
      current.map((item) =>
        String(item.product_id) === String(productId)
          ? { ...item, qty: Math.max(1, Number(qty) || 1) }
          : item
      )
    );
  };

  const removeItem = (productId) => {
    setCart((current) => current.filter((item) => String(item.product_id) !== String(productId)));
  };

  const confirm = async () => {
    if (!id) return alert('Missing purchase order id');
    if (cart.length === 0) return alert('Add at least one product');

    setConfirming(true);
    try {
      const res = await fetch(`/api/purchase-orders/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, items: cart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm purchase order');
      router.push('/purchase/purchase-orders');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to confirm purchase order');
    } finally {
      setConfirming(false);
    }
  };

  if (!id) {
    return (
      <MainLayout>
        <div className="text-gray-600">Missing purchase order id. Go back and start a new purchase order.</div>
      </MainLayout>
    );
  }

  const destinationLabel = draft?.destinationName || '—';
  const vendorLabel = draft?.vendorName || '—';

  return (
    <MainLayout>
      <div className="flex items-center gap-2 text-[12px] text-gray-500 mb-4">
        <span className="text-blue-600">Purchase</span>
        <i className="ti ti-chevron-right text-[11px] text-gray-400" />
        <span className="font-semibold text-gray-900">Purchase Order - line items</span>
      </div>

      <div className="flex gap-5 pb-28">
        <div className="w-[280px] flex-shrink-0 bg-white rounded-lg border border-gray-200 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <h3 className="text-[15px] font-semibold text-blue-600 mb-5">Purchase Order Information</h3>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Destination</label>
            <p className="text-[13px] font-medium text-gray-900">{loading ? '…' : destinationLabel}</p>
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Vendor Name</label>
            <p className="text-[13px] font-medium text-gray-900">{loading ? '…' : vendorLabel}</p>
          </div>

          <div className="flex gap-3 mb-4">
            <div className="flex-1">
              <label className="block text-[12px] text-gray-500 mb-1">Invoice Date</label>
              <input
                type="date"
                value={form.invoice_date}
                onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                disabled={readOnly}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[12px] text-gray-500 mb-1">Expected Delivery</label>
              <input
                type="date"
                value={form.expected_delivery_date}
                onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })}
                disabled={readOnly}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Shipment Mode</label>
            <input
              value={form.shipment_mode}
              onChange={(e) => setForm({ ...form, shipment_mode: e.target.value })}
              placeholder="Shipment mode"
              disabled={readOnly}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Invoice Number</label>
            <input
              value={form.invoice_number}
              onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
              placeholder="Invoice number"
              disabled={readOnly}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>

          <div>
            <label className="block text-[12px] text-gray-500 mb-1">CC Email</label>
            <textarea
              value={form.cc_emails}
              onChange={(e) => setForm({ ...form, cc_emails: e.target.value })}
              placeholder="CC emails"
              rows={5}
              disabled={readOnly}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 resize-none disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {!readOnly && (
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2.5 mb-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <i className="ti ti-search text-gray-400 text-[16px]" />
              <input
                type="text"
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
              />
            </div>
          )}

          <div className="bg-white rounded-lg border border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.03)] min-h-[calc(100vh-220px)] flex flex-col">
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-[14px] font-semibold text-gray-900">Purchase Order - Line Items</h2>
                <p className="text-[12px] text-gray-500 mt-0.5">Search products and confirm the transaction</p>
              </div>
              <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 min-w-[200px]">
                <input
                  type="text"
                  placeholder="Search"
                  value={cartFilter}
                  onChange={(e) => setCartFilter(e.target.value)}
                  className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
                />
                <i className="ti ti-search text-gray-400 text-[15px]" />
              </div>
            </div>

            <div className="flex-1 p-4 overflow-auto">
              {products.length > 0 && (
                <div className="mb-4 max-h-[360px] overflow-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
                  {products.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addToCart(product)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-blue-50/60 transition-colors"
                    >
                      <div>
                        <div className="text-[13px] font-medium text-gray-900">{product.name}</div>
                        <div className="text-[12px] text-gray-500">Barcode: {displayText(product.barcode)}</div>
                      </div>
                      <span className="text-[12px] font-medium text-blue-600">Add</span>
                    </button>
                  ))}
                </div>
              )}

              {products.length === 0 && (
                <p className="text-[13px] text-gray-500 text-center py-8">No products found</p>
              )}

              {filteredCart.length > 0 ? (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Product</th>
                      <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Available Qty</th>
                      <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Qty</th>
                      <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Cost</th>
                      <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Tax</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCart.map((item) => (
                      <tr key={item.product_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-3 px-2">
                          <div className="text-[13px] font-medium text-gray-900">{item.name}</div>
                          <div className="text-[11px] text-gray-500">{displayText(item.barcode)}</div>
                        </td>
                        <td className="py-3 px-2 text-[13px] text-gray-700">{Number(item.available_qty || 0).toLocaleString('en-IN')}</td>
                        <td className="py-3 px-2">
                          <input
                            type="number"
                            min={1}
                            value={item.qty}
                            onChange={(e) => updateQty(item.product_id, e.target.value)}
                            disabled={readOnly}
                            className="w-20 border border-gray-200 rounded px-2 py-1 text-[13px] text-gray-700 disabled:bg-gray-50 disabled:text-gray-500"
                          />
                        </td>
                        <td className="py-3 px-2 text-[13px] text-gray-700">{formatCurrency(item.cost_price)}</td>
                        <td className="py-3 px-2 text-[13px] text-gray-700">{formatCurrency(item.tax_value)}</td>
                        <td className="py-3 px-2">
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => removeItem(item.product_id)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                            >
                              <i className="ti ti-trash text-[16px]" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="min-h-[400px]" />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="fixed left-[218px] right-0 bottom-0 z-40 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(15,23,42,0.06)] max-md:left-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-10 flex-wrap">
            <span className="text-[13px] text-gray-600">
              Total Items: <strong className="text-gray-900 font-semibold">{totals.totalItems}</strong>
            </span>
            <span className="text-[13px] text-gray-600">
              Total Cost: <strong className="text-gray-900 font-semibold">{formatCurrency(totals.totalCost)}</strong>
            </span>
            <span className="text-[13px] text-gray-600">
              Total Tax Value: <strong className="text-gray-900 font-semibold">{formatCurrency(totals.totalTax)}</strong>
            </span>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCart([])}
                className="p-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                title="Clear cart"
              >
                <i className="ti ti-trash text-[18px]" />
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={confirming || cart.length === 0}
                className="px-5 py-2.5 rounded-lg bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {confirming ? 'Confirming…' : 'Confirm Transaction'}
              </button>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}

export default function PurchaseOrderLineItemsPage() {
  return (
    <Suspense fallback={<MainLayout><div className="text-gray-500 p-4">Loading…</div></MainLayout>}>
      <LineItemsContent />
    </Suspense>
  );
}
