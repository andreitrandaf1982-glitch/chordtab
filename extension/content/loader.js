// Content scripturile statice nu pot fi module ES — încărcătorul ăsta minuscul
// importă dinamic modulul real. Nu adăuga logică aici.
//
// Singurul loc din extensie cu `console` direct, și pe bună dreptate: dacă importul eșuează,
// nici loggerul nu s-a încărcat. N-avem cu ce raporta problema altfel.
(async () => {
  try {
    if (window.__chordtabLoaded) return;
    window.__chordtabLoaded = true;
    await import(chrome.runtime.getURL('content/content.js'));
  } catch (err) {
    console.error('[ChordTab:loader] Nu am putut încărca content.js:', err);
  }
})();
