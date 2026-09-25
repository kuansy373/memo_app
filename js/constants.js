export const APP_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? '/'
  : '/memo_app/';

export const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : 'https://memo-app-server-bew5.onrender.com';
