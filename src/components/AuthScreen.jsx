import Link from 'next/link';

export default function AuthScreen({
  title,
  subtitle,
  eyebrow,
  footerText,
  footerLinkText,
  footerLinkHref,
  children,
  highlights = [],
  brandTitle = 'Z Flow',
  brandTagline = 'Smarter billing. Stronger business.',
  leftPanelKicker = 'Z Flow',
  leftPanelTitle = 'Sell faster. Control every operation.',
  leftPanelSubtitle = 'Connect billing, inventory, purchases, customers and every store in one powerful workspace.',
}) {
  return (
    <div className="min-h-screen overflow-y-auto lg:h-screen lg:overflow-hidden bg-white text-slate-900">
      <div className="grid min-h-screen lg:h-screen lg:grid-cols-[1.02fr_0.98fr]">
        <section className="relative overflow-hidden bg-[#0b0d12] px-5 py-5 text-white sm:px-6 lg:px-10 lg:py-8">
          <div className="absolute -left-24 top-14 h-48 w-48 rounded-full bg-white/5 blur-3xl" />
          <div className="absolute -bottom-24 right-0 h-60 w-60 rounded-full bg-white/5 blur-3xl" />

          <div className="relative flex h-full flex-col justify-between gap-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <img src="/z-flow-logo.svg" alt={brandTitle} className="h-14 w-[210px] rounded bg-white object-contain object-left" />
                <p className="mt-1 text-[10px] leading-tight text-slate-300">{brandTagline}</p>
              </div>

              <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 backdrop-blur sm:flex">
                <span className="h-2 w-2 rounded-full bg-white" />
                <span className="text-[10px] font-medium text-slate-200">Secure workspace</span>
              </div>
            </div>

            <div className="max-w-xl space-y-4 lg:space-y-5">
              <div className="space-y-3">
                {leftPanelKicker && (
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-200 backdrop-blur">
                    <i className="ti ti-shield-lock text-[12px] text-white" />
                    {leftPanelKicker}
                  </div>
                )}

                {(leftPanelTitle || leftPanelSubtitle) && (
                  <div className="space-y-2.5">
                    {leftPanelTitle && (
                      <h1 className="max-w-xl text-[28px] font-bold tracking-tight sm:text-[32px] lg:text-[38px]">
                        {leftPanelTitle}
                      </h1>
                    )}
                    {leftPanelSubtitle && (
                      <p className="max-w-xl text-[12px] leading-5 text-slate-300 sm:text-[13px]">
                        {leftPanelSubtitle}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {highlights.map((item) => (
                    <div
                      key={item.title}
                      className="rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-[0_20px_50px_rgba(2,8,23,0.18)] backdrop-blur"
                    >
                      <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white">
                        <i className={`ti ${item.icon} text-[18px]`} />
                      </div>
                      <p className="text-[12px] font-semibold leading-4 text-white">{item.title}</p>
                      <p className="mt-1 text-[10.5px] leading-4 text-slate-400">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative max-w-xl rounded-3xl border border-white/10 bg-white/5 p-3.5 shadow-[0_24px_70px_rgba(2,8,23,0.2)] backdrop-blur">
              <div className="flex flex-wrap gap-2">
                {['Billing', 'Inventory', 'Customers', 'Reports'].map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-200"
                  >
                    {label}
                  </span>
                ))}
              </div>
              <p className="mt-2.5 text-[10.5px] leading-4 text-slate-400">
                One connected platform for billing, inventory, customers, purchases and reporting.
              </p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-5 sm:px-6 lg:px-8 lg:py-6">
          <div className="w-full max-w-lg">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-7">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  {eyebrow && (
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-600">
                      {eyebrow}
                    </p>
                  )}
                  {title && (
                    <h2 className="mt-1.5 text-[22px] font-bold text-gray-900 sm:text-[24px]">
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="mt-1.5 text-[12px] leading-5 text-gray-500">
                      {subtitle}
                    </p>
                  )}
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100">
                  <img src="/z-flow-icon.svg" alt="" className="h-8 w-8 object-contain" aria-hidden="true" />
                </div>
              </div>

              {children}

              <div className="mt-4 border-t border-gray-100 pt-3.5 text-[12px] text-gray-500">
                <p>
                  {footerText}
                  {footerText && footerLinkText && footerLinkHref && (
                    <>
                      {' '}
                      <Link href={footerLinkHref} className="font-semibold text-blue-600 hover:underline">
                        {footerLinkText}
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
