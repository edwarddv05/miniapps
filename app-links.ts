/** Links the share extension, the widget and the download Live Activity open: miniapps://download?url=…, miniapps://schedule and miniapps://downloads. */
export type AppLink = { kind: 'download'; url: string } | { kind: 'schedule' } | { kind: 'downloads' };

export function parseAppLink(link: string): AppLink | null {
  const match = /^miniapps:\/\/([a-z]+)\/?(?:\?(.*))?$/i.exec(link.trim());
  if (!match) return null;
  const route = match[1].toLowerCase();
  if (route === 'schedule') return { kind: 'schedule' };
  if (route === 'downloads') return { kind: 'downloads' };
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
