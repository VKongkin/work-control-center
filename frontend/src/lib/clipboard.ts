/**
 * Copy text, and say honestly whether it worked.
 *
 * `navigator.clipboard` only exists in a secure context. Over plain HTTP that
 * means localhost and nothing else - so the moment WCC is opened as
 * http://thatserver.bank.local:3000 it is simply undefined. The existing code
 * called it with `?.`, which turned that into silence: the button appeared to
 * work and the clipboard was empty.
 *
 * The fallback is the old execCommand trick, which still works everywhere that
 * matters. If both fail the caller is told, so it can show the text instead of
 * pretending.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through - a permissions policy can reject it even in a secure context
  }

  try {
    const el = document.createElement('textarea');
    el.value = text;
    // Off-screen rather than hidden: a display:none element cannot be selected.
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/** Hand the browser a file built in memory, without a round trip to the server. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick: revoking immediately can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
