/** Links the share extension and the widget open: miniapps://download?url=… and miniapps://schedule. */
export type AppLink = { kind: 'download'; url: string } | { kind: 'schedule' };

export function parseAppLink(link: string): AppLink | null {
  const match = /^miniapps:\/\/([a-z]+)\/?(?:\?(.*))?$/i.exec(link.trim());
  if (!match) return null;
  const route = match[1].toLowerCase();
  if (route === 'schedule') return { kind: 'schedule' };
  if (route !== 'download') return null;
  for (const pair of (match[2] ?? '').split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key !== 'url') continue;
    try {
      const url = decodeURIComponent(value.replace(/\+/g, ' ')).trim();
      return /^https?:\/\//i.test(url) ? { kind: 'download', url } : null;
    } catch {
      return null;
    }
  }
  return null;
}
