'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import MainLayout from '@/components/MainLayout';

const quickPrompts = [
  "Show today's employee sales performance",
  'Show top cashier for the last 7 days',
  'Show employee activity from yesterday',
  'Show near-expiry product risk',
];

const initialBotMessage = {
  role: 'assistant',
  title: 'Admin Assistant',
  answer:
    'Ready for Super Admin. You can ask in English, Hindi, or Hinglish about sales performance, employee activity, stock operations, and expiry risk.',
  cards: [
    { label: 'Sales', value: 'employee wise' },
    { label: 'Activity', value: 'audit logs' },
    { label: 'Expiry', value: 'risk view' },
  ],
};

function AssistantResult({ message }) {
  const columns = message.table?.columns || [];
  const rows = message.table?.rows || [];

  return (
    <div className="space-y-4">
      {message.title ? <h3 className="text-[15px] font-semibold text-slate-950">{message.title}</h3> : null}
      <p className="text-[13.5px] leading-6 text-slate-700">{message.answer}</p>

      {message.cards?.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {message.cards.map((card) => (
            <div key={`${card.label}-${card.value}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">{card.label}</div>
              <div className="mt-1 text-[15px] font-bold text-indigo-600">{card.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-left text-[12.5px]">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="whitespace-nowrap px-3 py-3 font-semibold">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
              {rows.map((row, index) => (
                <tr key={`${index}-${columns.map((column) => row[column]).join('-')}`}>
                  {columns.map((column) => (
                    <td key={column} className="whitespace-nowrap px-3 py-3">
                      {row[column] ?? '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {message.links?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-indigo-200 px-3 py-2 text-[12px] font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminAssistantPage() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([initialBotMessage]);
  const bottomRef = useRef(null);

  const isSuperAdmin = useMemo(
    () => user?.role === 'super_admin' || user?.permissions?.includes('*'),
    [user],
  );

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) setUser(json?.data?.user || null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function askAssistant(prompt = input) {
    const message = prompt.trim();
    if (!message || loading) return;

    setInput('');
    setLoading(true);
    setMessages((current) => [...current, { role: 'user', answer: message }]);

    try {
      const res = await fetch('/api/admin/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Assistant failed');
      }
      setMessages((current) => [...current, { role: 'assistant', ...json.data }]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          title: 'Unable to answer',
          answer: err.message || 'Abhi data fetch nahi ho paya. Thodi der baad try karein.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <MainLayout>
        <div className="p-6 text-sm text-slate-500">Loading assistant...</div>
      </MainLayout>
    );
  }

  if (!isSuperAdmin) {
    return (
      <MainLayout>
        <div className="mx-auto mt-10 max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">Access denied</h1>
          <p className="mt-2 text-sm text-slate-600">Admin Assistant sirf Super Admin ke liye available hai.</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="min-h-[calc(100vh-110px)] bg-slate-50 px-3 py-4 sm:px-5 sm:py-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 md:flex-row md:items-end">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500">Super Admin</div>
              <h1 className="mt-1 text-2xl font-bold text-slate-950">Admin Assistant</h1>
              <p className="mt-1 text-sm text-slate-500">
                Ask in English, Hindi, or Hinglish for store-wise employee performance, audit activity, stock operations, and expiry risk.
              </p>
            </div>
            <Link
              href="/inventory/expiry-alerts"
              className="w-full rounded-lg border border-indigo-200 px-4 py-2 text-center text-sm font-semibold text-indigo-600 hover:bg-indigo-50 sm:w-auto"
            >
              Near Expiry
            </Link>
          </div>

          <div className="grid gap-4 lg:min-h-[620px] lg:grid-cols-[280px_1fr]">
            <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-[13px] font-bold text-slate-950">Quick questions</h2>
              <div className="mt-3 space-y-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => askAssistant(prompt)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-3 text-left text-[12.5px] font-medium text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <div className="mt-5 rounded-lg bg-slate-50 p-3 text-[12px] leading-5 text-slate-600">
                Try dates like today, yesterday, last 7 days, 01-06-2026, or 1 June.
                Filter by store using store 2 or the store name.
              </div>
            </aside>

            <section className="flex min-h-[520px] flex-col rounded-lg border border-slate-200 bg-white shadow-sm lg:min-h-[620px]">
              <div className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={
                        message.role === 'user'
                          ? 'max-w-[90%] rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white sm:max-w-[78%]'
                          : 'max-w-full rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm sm:max-w-[94%]'
                      }
                    >
                      {message.role === 'user' ? message.answer : <AssistantResult message={message} />}
                    </div>
                  </div>
                ))}
                {loading ? (
                  <div className="flex justify-start">
                    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                      fetching the data...
                    </div>
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  askAssistant();
                }}
                className="border-t border-slate-200 p-3 sm:p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Example: show sales by employee for store 2 yesterday"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="rounded-lg bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
                  >
                    Ask
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
