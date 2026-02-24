import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Lock, ArrowRight } from 'lucide-react';
import { api } from '../services/api';
import { useI18n } from '../services/i18n';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { t, tx } = useI18n();
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const resp = await api.login({ email: token || 'token', password: token });
      localStorage.setItem('auth_token', resp.token || '');
      localStorage.setItem('user_role', 'RESEARCHER');
      navigate('/');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`${t('login.error', 'Login failed')}: ${detail}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col justify-center bg-[radial-gradient(120%_70%_at_0%_0%,rgba(191,219,254,0.45),rgba(191,219,254,0)),radial-gradient(95%_60%_at_100%_0%,rgba(167,243,208,0.32),rgba(167,243,208,0)),linear-gradient(180deg,#f8fbff_0%,#f1f7fd_100%)] py-12 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: 'linear-gradient(rgba(148,163,184,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.2) 1px, transparent 1px)', backgroundSize: '38px 38px', maskImage: 'linear-gradient(180deg,rgba(0,0,0,0.7),transparent 80%)' }} />
      <div className="relative sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
            <div className="flex h-13 w-13 -rotate-3 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-[0_16px_30px_rgba(37,99,235,0.35)]">
                <Activity className="h-7 w-7 text-white" />
            </div>
        </div>
        <h2 className="display-title mt-6 text-center text-3xl font-extrabold text-slate-900">
          {tx('RL 研究平台', 'RL Research Platform')}
        </h2>
        <p className="mt-2 text-center text-sm text-slate-600">
          {t('login.subtitle', 'Sign in to access cluster resources and experiments')}
        </p>
      </div>

      <div className="relative mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="rounded-2xl border border-slate-200/80 bg-white/88 px-5 py-8 shadow-[0_18px_42px_rgba(15,23,42,0.12)] backdrop-blur-md sm:px-10">
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label htmlFor="token" className="block text-sm font-medium text-slate-700">
                {t('login.tokenLabel', 'Access Token / API Key')}
              </label>
              <div className="relative mt-1 rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="token"
                  name="token"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="block w-full rounded-lg border border-slate-300/80 bg-white/85 p-3 pl-10 text-sm text-slate-900 focus:border-blue-500 focus:ring-blue-500"
                  placeholder="sk-..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="flex w-full justify-center rounded-lg border border-transparent bg-gradient-to-br from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-[0_12px_24px_rgba(37,99,235,0.3)] transition-all hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-70"
              >
                {isLoading ? t('login.authenticating', 'Authenticating...') : (
                    <span className="flex items-center">
                        {t('login.signIn', 'Sign In')} <ArrowRight className="ml-2 w-4 h-4" />
                    </span>
                )}
              </button>
            </div>
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            )}
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-slate-500">
                  {t('login.protected', 'Protected System')}
                </span>
              </div>
            </div>
            <div className="mt-6 text-center text-xs text-slate-400">
                {t('login.notice', 'Authorized use only. All activities are monitored.')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
