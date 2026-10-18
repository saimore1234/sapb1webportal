import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2, ShieldCheck, Building2, ChevronDown, AlertCircle, Check, Clock, Settings2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCompanies } from '../api/auth';
import CompanySetupModal from '../components/CompanySetupModal';
import type { CompanyOption } from '../types';

const REMEMBER_KEY = 'b1_remember';

type LoginError = 'credentials' | 'connect' | 'company';

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const sessionExpired = params.get('reason') === 'expired';

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);

  const [companyDb, setCompanyDb] = useState('');
  const [companyOpen, setCompanyOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const comboRef = useRef<HTMLDivElement>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getCompanies();
        if (cancelled) return;
        setCompanies(list);

        let remembered: { companyDb?: string; username?: string } = {};
        try {
          remembered = JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}');
        } catch {
          remembered = {};
        }

        if (remembered.companyDb && list.some((c) => c.code === remembered.companyDb)) {
          setCompanyDb(remembered.companyDb);
          setRememberMe(true);
        } else if (list.length > 0) {
          setCompanyDb(list[0].code);
        }
        if (remembered.username) setUsername(remembered.username);
      } catch {
        if (cancelled) return;
        setCompaniesError('Unable to load the company list. Please refresh and try again.');
      } finally {
        if (!cancelled) setCompaniesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!companyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!comboRef.current?.contains(e.target as Node)) setCompanyOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [companyOpen]);

  if (isAuthenticated) {
    const from = (location.state as { from?: Location })?.from?.pathname || '/';
    return <Navigate to={from} replace />;
  }

  async function onCompanyCreated(code: string) {
    setSetupOpen(false);
    setCompaniesError(null);
    try {
      const list = await getCompanies();
      setCompanies(list);
      if (list.some((c) => c.code === code)) setCompanyDb(code);
    } catch {
      setCompaniesError('Unable to load the company list. Please refresh and try again.');
    }
  }

  function fail(kind: LoginError) {
    setError(kind);
    setShakeKey((k) => k + 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!companyDb) {
      fail('company');
      return;
    }

    setSubmitting(true);
    try {
      await login(companyDb, username, password);
      try {
        if (rememberMe) {
          localStorage.setItem(REMEMBER_KEY, JSON.stringify({ companyDb, username }));
        } else {
          localStorage.removeItem(REMEMBER_KEY);
        }
      } catch {
        // Storage unavailable — non-fatal, login already succeeded.
      }
      navigate('/', { replace: true });
    } catch (err: any) {
      // Raw API messages are never shown — map to a clean category instead.
      const status = err?.response?.status;
      fail(!err?.response || status >= 500 ? 'connect' : 'credentials');
    } finally {
      setSubmitting(false);
    }
  }

  const selected = companies.find((c) => c.code === companyDb);
  const comboDisabled = companiesLoading || companies.length === 0;

  function openCombo() {
    if (comboDisabled) return;
    setActiveIdx(Math.max(0, companies.findIndex((c) => c.code === companyDb)));
    setCompanyOpen(true);
  }

  function pick(code: string) {
    setCompanyDb(code);
    setCompanyOpen(false);
  }

  function onComboKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Escape') {
      if (companyOpen) {
        e.preventDefault();
        setCompanyOpen(false);
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!companyOpen) return openCombo();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIdx((i) => (i + d + companies.length) % companies.length);
    } else if (e.key === 'Enter' && companyOpen) {
      // Enter inside the open list selects; it must not submit the form.
      e.preventDefault();
      pick(companies[activeIdx].code);
    } else if (e.key === ' ') {
      e.preventDefault();
      if (companyOpen) pick(companies[activeIdx].code);
      else openCombo();
    } else if (e.key === 'Home' && companyOpen) {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === 'End' && companyOpen) {
      e.preventDefault();
      setActiveIdx(companies.length - 1);
    } else if (e.key === 'Tab') {
      setCompanyOpen(false);
    }
  }

  const label = 'block text-[13px] font-medium text-ink-secondary mb-1.5';
  const field =
    'w-full h-11 bg-surface border border-border-strong rounded-md px-3.5 text-[15px] text-ink-primary placeholder:text-ink-tertiary ' +
    'transition-[border-color,box-shadow] duration-150 hover:border-ink-tertiary ' +
    'focus:outline-none focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/25 disabled:opacity-60';

  return (
    <div className="min-h-screen flex bg-bg">
      {/* Left — brand panel (reduced on tablet, hidden on mobile) */}
      <aside className="hidden md:flex md:w-[34%] lg:w-[42%] relative overflow-hidden bg-brand-950 text-white flex-col justify-between p-8 lg:p-14">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-900 via-brand-950 to-brand-950" />
          <svg className="absolute inset-0 h-full w-full opacity-[0.06]">
            <defs>
              <pattern id="hub-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hub-grid)" />
          </svg>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="relative flex items-center gap-3">
          <HubLogo className="h-10 w-10 shrink-0" />
          <div className="leading-tight">
            <div className="text-lg lg:text-xl font-semibold tracking-tight">SAP B1 Business Hub</div>
            <div className="text-xs text-white/55">Business Management Platform</div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="relative">
          <h1 className="text-2xl lg:text-[2rem] font-semibold leading-tight max-w-sm">One intelligent workspace for your business.</h1>
          <p className="mt-3 text-sm text-white/55 max-w-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0" /> Enterprise data, connected securely.
          </p>
          <DataFlow className="hidden lg:block mt-10 w-full max-w-md" />
        </motion.div>

        <div className="relative text-xs text-white/40">Enterprise Business Platform</div>
      </aside>

      {/* Right — login (primary focus) */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 flex items-center justify-center px-5 py-10 sm:px-8">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }} className="w-full max-w-[420px]">
            <div className="md:hidden flex flex-col items-center text-center mb-8">
              <HubLogo className="h-12 w-12" dark />
              <div className="mt-3 text-xl font-semibold text-ink-primary tracking-tight">SAP B1 Business Hub</div>
              <div className="text-xs text-ink-secondary">Business Management Platform</div>
            </div>

            <div className="mb-7">
              <h2 className="text-[28px] leading-8 font-semibold text-ink-primary tracking-tight">Welcome back</h2>
              <p className="text-ink-secondary text-sm mt-1.5">Sign in to continue to your business workspace.</p>
            </div>

            {sessionExpired && !error && (
              <div role="status" className="mb-5 flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-bg px-3.5 py-3 text-sm text-warning">
                <Clock className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">Your session has expired.</div>
                  <div className="opacity-90">Please sign in again.</div>
                </div>
              </div>
            )}

            {error && (
              <motion.div
                key={shakeKey}
                role="alert"
                initial={{ x: 0 }}
                animate={{ x: [0, -5, 5, -3, 3, 0] }}
                transition={{ duration: 0.4 }}
                className="mb-5 rounded-md border border-danger/30 bg-danger-bg px-3.5 py-3 text-sm text-danger"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-medium">{error === 'connect' ? 'Unable to connect to the selected company.' : 'Unable to sign in'}</div>
                    <div className="opacity-90">
                      {error === 'company'
                        ? 'Please select a company.'
                        : error === 'connect'
                          ? 'Please try again, or choose a different company.'
                          : 'Please check your company, username and password.'}
                    </div>
                    <button
                      type="button"
                      onClick={() => setError(null)}
                      className="mt-2 font-medium underline underline-offset-2 hover:no-underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
            {companiesError && (
              <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-bg px-3.5 py-3 text-sm text-danger">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {companiesError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Company — accessible custom listbox. The API only returns code + name,
                  so no live/test badge is shown. */}
              <div ref={comboRef} className="relative">
                <label id="company-label" className={label}>
                  Company
                </label>
                <button
                  type="button"
                  role="combobox"
                  aria-haspopup="listbox"
                  aria-expanded={companyOpen}
                  aria-controls="company-listbox"
                  aria-labelledby="company-label"
                  aria-activedescendant={companyOpen ? `company-opt-${activeIdx}` : undefined}
                  disabled={comboDisabled}
                  onClick={() => (companyOpen ? setCompanyOpen(false) : openCombo())}
                  onKeyDown={onComboKey}
                  className={`${field} flex items-center gap-2.5 text-left cursor-pointer`}
                >
                  <Building2 className="h-4 w-4 text-ink-tertiary shrink-0" />
                  <span className={`flex-1 truncate ${selected ? '' : 'text-ink-tertiary'}`}>
                    {companiesLoading ? 'Loading companies...' : companies.length === 0 ? 'No companies available' : selected?.name ?? 'Select Company'}
                  </span>
                  {companiesLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" />
                  ) : (
                    <ChevronDown className={`h-4 w-4 text-ink-tertiary transition-transform duration-150 ${companyOpen ? 'rotate-180' : ''}`} />
                  )}
                </button>
                {companyOpen && (
                  <ul
                    id="company-listbox"
                    role="listbox"
                    aria-labelledby="company-label"
                    className="absolute z-20 mt-1.5 w-full max-h-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-popover animate-slide-up"
                  >
                    {companies.map((c, i) => (
                      <li
                        key={c.code}
                        id={`company-opt-${i}`}
                        role="option"
                        aria-selected={c.code === companyDb}
                        onMouseEnter={() => setActiveIdx(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(c.code)}
                        className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm cursor-pointer text-ink-primary ${i === activeIdx ? 'bg-surface-tertiary' : ''}`}
                      >
                        <span className="truncate">{c.name}</span>
                        {c.code === companyDb && <Check className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0" />}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => setSetupOpen(true)}
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 dark:text-brand-400 hover:underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {companies.length === 0 && !companiesLoading ? 'No company yet? Configure company' : 'Configure company'}
                </button>
              </div>

              <div>
                <label htmlFor="login-username" className={label}>
                  Username
                </label>
                <input
                  id="login-username"
                  className={field}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label htmlFor="login-password" className={label}>
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    className={`${field} pr-11`}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded text-ink-tertiary hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-border-strong text-brand-600 focus:ring-brand-500"
                />
                Remember me
              </label>

              <button
                type="submit"
                className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-[15px] font-medium shadow-subtle transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={submitting || companiesLoading}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <div className="flex items-center justify-center gap-1.5 text-xs text-ink-tertiary mt-7">
              <ShieldCheck className="h-3.5 w-3.5" />
              Secure enterprise access
            </div>
          </motion.div>
        </div>

        {setupOpen && <CompanySetupModal onClose={() => setSetupOpen(false)} onCreated={onCompanyCreated} />}

        <footer className="px-6 py-5 text-center text-xs text-ink-tertiary">© 2026 SAP B1 Business Hub · Enterprise Business Platform</footer>
      </main>
    </div>
  );
}

/** Original mark: a hub node connected to three satellites inside a rounded square. */
function HubLogo({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label="SAP B1 Business Hub logo">
      <rect width="40" height="40" rx="9" fill={dark ? 'rgb(var(--brand-700))' : 'rgba(255,255,255,0.12)'} />
      <g stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.85">
        <path d="M20 20 L11 12 M20 20 L30 13 M20 20 L20 31" />
      </g>
      <circle cx="11" cy="12" r="2.6" fill="white" opacity="0.8" />
      <circle cx="30" cy="13" r="2.6" fill="white" opacity="0.8" />
      <circle cx="20" cy="31" r="2.6" fill="white" opacity="0.8" />
      <circle cx="20" cy="20" r="4.6" fill="white" />
    </svg>
  );
}

/** Subtle abstract ERP document flow: Sales → Inventory → Finance, with a small bar/trend chart. */
function DataFlow({ className = '' }: { className?: string }) {
  const nodes = [
    { x: 20, y: 30, t: 'Sales' },
    { x: 150, y: 86, t: 'Inventory' },
    { x: 280, y: 30, t: 'Finance' }
  ];
  return (
    <svg viewBox="0 0 360 190" className={className} aria-hidden="true" fill="none">
      <path d="M90 46 C120 46 120 102 150 102 M220 102 C250 102 250 46 280 46" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" strokeDasharray="4 5" />
      {nodes.map((n) => (
        <g key={n.t}>
          <rect x={n.x} y={n.y} width="70" height="32" rx="6" fill="white" fillOpacity="0.07" stroke="white" strokeOpacity="0.25" />
          <text x={n.x + 35} y={n.y + 20} textAnchor="middle" fontSize="11" fill="white" fillOpacity="0.75" fontFamily="Inter, sans-serif">
            {n.t}
          </text>
        </g>
      ))}
      <g fill="white" fillOpacity="0.18">
        {[40, 62, 50, 78, 66, 94, 84].map((h, i) => (
          <rect key={i} x={20 + i * 22} y={180 - h * 0.9} width="12" height={h * 0.9} rx="2" />
        ))}
      </g>
      <polyline points="26,118 48,104 70,110 92,92 114,98 136,76 158,82" stroke="white" strokeOpacity="0.6" strokeWidth="1.6" strokeLinejoin="round" transform="translate(190 20) scale(0.8)" />
    </svg>
  );
}
