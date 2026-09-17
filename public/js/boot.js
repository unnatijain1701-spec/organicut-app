/* ═══════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════ */

checkAuth();

window.addEventListener('beforeunload', e => {
  if (_isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

