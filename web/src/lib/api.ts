export const apiBaseUrl = 'http://localhost:8000/api/v1';

const authFetch = async (url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  
  // You can add token logic here if needed
  // const token = localStorage.getItem('auth_token');
  // if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }
  return response.json();
};

export const api = {
  // --- Dashboard Data ---
  getSystemResources: () => authFetch(`${apiBaseUrl}/system-resources`).catch(() => null),
  getRuns: (params?: any) => {
    const url = new URL(`${apiBaseUrl}/runs`);
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined) url.searchParams.append(key, params[key]);
      });
    }
    return authFetch(url.toString());
  },
  
  // --- Registry Data ---
  getModels: () => authFetch(`${apiBaseUrl}/models`),
  getEnvs: () => authFetch(`${apiBaseUrl}/envs`),
  getAlgos: () => authFetch(`${apiBaseUrl}/algos`),
  
  // --- Jobs ---
  getJobs: () => authFetch(`${apiBaseUrl}/jobs`).catch(() => []), // Fallback if endpoint varies
  submitDemoJob: (data: { env: string, algo: string, gpu: string }) => authFetch(`${apiBaseUrl}/runs/demo-submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
};
