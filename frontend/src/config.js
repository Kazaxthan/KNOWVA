export const IS_DEMO = import.meta.env.VITE_KNOWVA_MODE === 'demo';
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
