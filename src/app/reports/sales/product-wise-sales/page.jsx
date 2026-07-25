import ReportsListPage from '@/components/ReportListPage';

const filters = [
  {
    "key": "date_range",
    "label": "Date Range",
    "type": "date-range"
  },
  {
    "key": "region",
    "label": "Select Region",
    "type": "text"
  }
];

const columns = [
  {
    "key": "product",
    "label": "Product"
  },
  {
    "key": "store",
    "label": "Store"
  },
  {
    "key": "date",
    "label": "Date"
  },
  {
    "key": "quantity",
    "label": "Qty"
  },
  {
    "key": "sales",
    "label": "Sales"
  },
  {
    "key": "discount",
    "label": "Discount"
  },
  {
    "key": "net_bill",
    "label": "Net Bill"
  },
  {
    "key": "taxes",
    "label": "Taxes"
  },
  {
    "key": "gross_bill",
    "label": "Gross Bill"
  },
  {
    "key": "orders",
    "label": "Orders"
  },
  {
    "key": "cost_amount",
    "label": "Cost Amount"
  },
  {
    "key": "margin_amount",
    "label": "Margin Amount"
  },
  {
    "key": "margin_percent",
    "label": "Margin %"
  },
  {
    "key": "avg_order_value",
    "label": "Avg Order Value"
  }
];

export default function SalesProductWiseSalesPage() {
  return (
    <ReportsListPage
      breadcrumbs={[
        { label: 'Reports Dashboard', href: '/reports' },
        { label: 'Sales' },
        { label: 'Product Wise Sales' },
      ]}
      title="Product Wise Sales"
      description="Sales by product"
      filters={filters}
      columns={columns}
      reportKey="sales/product-wise-sales"
      actionButtons={[]}
    />
  );
}
