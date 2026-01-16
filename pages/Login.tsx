import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Lock, ArrowRight } from 'lucide-react';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Mock authentication
    setTimeout(() => {
        localStorage.setItem('auth_token', token || 'mock_token');
        localStorage.setItem('user_role', 'RESEARCHER');
        setIsLoading(false);
        navigate('/');
    }, 800);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg transform -rotate-6">
                <Activity className="text-white w-7 h-7" />
            </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          RL Research Platform
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Sign in to access cluster resources and experiments
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-gray-100">
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label htmlFor="token" className="block text-sm font-medium text-gray-700">
                Access Token / API Key
              </label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="token"
                  name="token"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md p-3 border"
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
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-70 transition-all"
              >
                {isLoading ? 'Authenticating...' : (
                    <span className="flex items-center">
                        Sign In <ArrowRight className="ml-2 w-4 h-4" />
                    </span>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">
                  Protected System
                </span>
              </div>
            </div>
            <div className="mt-6 text-center text-xs text-gray-400">
                Authorized use only. All activities are monitored.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};