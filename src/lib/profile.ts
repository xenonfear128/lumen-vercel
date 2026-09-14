export function profileKey(key: string, scope = 'guest') {
  return scope === 'guest' ? key : `lumen.user.${scope}.${key}`;
}
