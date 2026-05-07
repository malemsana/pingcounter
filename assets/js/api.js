const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalHost ? 'http://localhost:3000' : 'https://pingcounter.onrender.com';

const api = {
    getToken: () => localStorage.getItem('token') || '',
    setToken: (token) => {
        if (token) localStorage.setItem('token', token);
        else localStorage.removeItem('token');
    },
    request: async (path, options = {}) => {
        const token = api.getToken();
        try {
            const res = await fetch(`${API_BASE}${path}`, {
                ...options,
                headers: {
                    'Authorization': token ? `Bearer ${token}` : '',
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'bad_request');
            return data;
        } catch (err) {
            if (err.message === 'unauthorized') {
                api.setToken(null);
                if (!window.location.pathname.endsWith('auth.html')) {
                    window.location.href = 'auth.html';
                }
            }
            throw err;
        }
    }
};
