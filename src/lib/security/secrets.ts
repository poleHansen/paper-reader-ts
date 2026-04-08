export function encodeSecret(value: string): string {
  return value ? Buffer.from(value, 'utf8').toString('base64') : '';
}

export function decodeSecret(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}
