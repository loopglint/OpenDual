/**
 * Requests optional Chrome host permission for custom API / LAN Ollama / custom Whisper URLs
 * inside a user-gesture handler (e.g. "Test Connection" or "Refresh Models").
 */
export async function ensureHostPermissionForUrl(rawUrl?: string): Promise<boolean> {
  if (!rawUrl || typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return true;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const originPattern = `${parsed.protocol}//${parsed.hostname}/*`;
    const has = await chrome.permissions.contains({ origins: [originPattern] });
    if (has) return true;
    return await chrome.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
}
