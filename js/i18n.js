// Tamil/English UI language helpers. Split out of the inline <script> that
// used to sit after </html> in index.html (malformed placement, and every
// other module needs it — moved here so it's a real, ordered dependency).
export function _isTa() { return localStorage.getItem('lang') === 'ta'; }
export function _ta(en, ta) { return _isTa() ? ta : en; }
