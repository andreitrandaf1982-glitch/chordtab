// Content scripturile statice nu pot fi module ES — încărcătorul ăsta minuscul
// importă dinamic modulul real. Nu adăuga logică aici.
(async () => {
  try {
    if (window.__chordtabLoaded) return;
    window.__chordtabLoaded = true;
    await import(chrome.runtime.getURL('content/content.js'));
  } catch (err) {
    console.error('[ChordTab:loader] Nu am putut încărca content.js:', err);
  }
})();
