'use client';

import { useCallback, useEffect, useState } from 'react';
import MainLayout from '@/components/MainLayout';

const initialForm = {
  organizationName: '',
  loginId: '',
  email: '',
  password: '',
  name: '',
  phone: '',
  trialDays: 14,
  maxUsers: 3,
  maxStores: 1,
};

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusClasses(status) {
  if (status === 'active' || status === 'paid') return 'bg-emerald-50 text-emerald-700';
  if (status === 'suspended' || status === 'expired') return 'bg-rose-50 text-rose-700';
  return 'bg-amber-50 text-amber-700';
}

export default function TrialAccountsPage() {
  const [form, setForm] = useState(initialForm);
  const [trials, setTrials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadTrials = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/platform/trials', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'Unable to load trial accounts');
      }
      setTrials(payload.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrials();
  }, [loadTrials]);

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const createTrial = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/platform/trials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'Unable to create trial');
      }
      setMessage(`Trial created. User ID: ${payload.data.loginId}`);
      setForm(initialForm);
      await loadTrials();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateTrial = async (id, changes) => {
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/platform/trials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...changes }),
      });
      const payload = await response.json();
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'Unable to update trial');
      }
      setMessage('Trial updated successfully.');
      await loadTrials();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <MainLayout>
      <div className="mx-auto max-w-[1500px] space-y-7">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
              Platform Super Admin
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#0b0d12]">
              Trial accounts
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Create isolated trial workspaces. Every account gets its own empty database and
              cannot access another organization&apos;s data.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600">
            {trials.length} total trials
          </div>
        </header>

        {(message || error) && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
              error
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {error || message}
          </div>
        )}

        <div className="grid gap-7 xl:grid-cols-[420px_minmax(0,1fr)]">
          <form
            onSubmit={createTrial}
            className="h-fit rounded-3xl border border-slate-200 bg-white p-6"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-[#0b0d12]">Create free trial</p>
                <p className="mt-1 text-xs text-slate-500">You control the credentials.</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0b0d12] text-white">
                <i className="ti ti-user-plus text-xl" />
              </div>
            </div>

            <div className="space-y-4">
              {[
                ['organizationName', 'Organization name', 'Acme Retail', 'text', true],
                ['loginId', 'User ID', 'acme-owner', 'text', true],
                ['name', 'Owner name', 'Account owner', 'text', true],
                ['email', 'Email (optional)', 'owner@company.com', 'email', false],
                ['phone', 'Phone (optional)', '9876543210', 'text', false],
                ['password', 'Temporary password', 'Minimum 8 characters', 'password', true],
              ].map(([field, label, placeholder, type, required]) => (
                <label key={field} className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span>
                  <input
                    type={type}
                    required={required}
                    value={form[field]}
                    onChange={(event) => setField(field, event.target.value)}
                    placeholder={placeholder}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                  />
                </label>
              ))}

              <div className="grid grid-cols-3 gap-3">
                {[
                  ['trialDays', 'Days'],
                  ['maxUsers', 'Users'],
                  ['maxStores', 'Stores'],
                ].map(([field, label]) => (
                  <label key={field} className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span>
                    <input
                      type="number"
                      min="1"
                      max={field === 'trialDays' ? 90 : 50}
                      required
                      value={form[field]}
                      onChange={(event) => setField(field, Number(event.target.value))}
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0b0d12] px-5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Provisioning workspace…' : 'Create isolated trial'}
              {!saving && <i className="ti ti-arrow-right" />}
            </button>
          </form>

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-[#0b0d12]">Provisioned workspaces</h2>
                <p className="mt-1 text-xs text-slate-500">Passwords are never displayed.</p>
              </div>
              <button
                type="button"
                onClick={loadTrials}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="p-10 text-center text-sm text-slate-500">Loading trials…</div>
            ) : trials.length === 0 ? (
              <div className="p-10 text-center">
                <p className="font-semibold text-slate-800">No trials created yet</p>
                <p className="mt-1 text-sm text-slate-500">Create the first isolated workspace.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {trials.map((trial) => (
                  <article key={trial.id} className="p-5">
                    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-semibold text-[#0b0d12]">
                            {trial.organizationName}
                          </h3>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusClasses(trial.status)}`}
                          >
                            {trial.status}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-x-8 gap-y-2 text-xs text-slate-500 sm:grid-cols-2">
                          <p><span className="font-semibold text-slate-700">User ID:</span> {trial.loginId || '—'}</p>
                          <p><span className="font-semibold text-slate-700">Owner:</span> {trial.ownerName || '—'}</p>
                          <p><span className="font-semibold text-slate-700">Expires:</span> {formatDate(trial.trialEndsAt)}</p>
                          <p><span className="font-semibold text-slate-700">Limits:</span> {trial.maxUsers} users · {trial.maxStores} stores</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updateTrial(trial.id, { extendDays: 7 })}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          +7 days
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateTrial(trial.id, {
                              status: trial.status === 'suspended' ? 'active' : 'suspended',
                            })
                          }
                          className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                            trial.status === 'suspended'
                              ? 'bg-[#0b0d12] text-white'
                              : 'border border-rose-200 text-rose-700 hover:bg-rose-50'
                          }`}
                        >
                          {trial.status === 'suspended' ? 'Activate' : 'Suspend'}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </MainLayout>
  );
}
