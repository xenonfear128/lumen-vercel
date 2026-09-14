const { fail } = require('./security.cjs');
const identifier = value => typeof value === 'string' && /^[\w:.-]{1,160}$/.test(value);
const string = (v, max = 500) => typeof v === 'string' ? v.slice(0, max) : null;
const number = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, 1e15) : null;
function trackData(value) {
  if (!value || !['local', 'netease'].includes(value.source)) fail('SYNC_INVALID');
  if (value.source === 'netease' && (!Number.isSafeInteger(value.neteaseId) || value.neteaseId < 1)) fail('SYNC_INVALID');
  if (value.source === 'local' && !identifier(value.localFileId)) fail('SYNC_INVALID');
  const out = { source: value.source, neteaseId: value.source === 'netease' ? value.neteaseId : null,
    localFileId: value.source === 'local' ? value.localFileId : null,
    fileName: (string(value.fileName) || 'Audio').split(/[\\/]/).pop(), metaLoaded: true,
    fallbackCover: Math.min(5, Math.floor(number(value.fallbackCover) || 0)) };
  for (const key of ['title', 'artist', 'album', 'genre', 'codec']) out[key] = string(value[key]);
  for (const key of ['year', 'duration', 'bitrate', 'sampleRate']) out[key] = number(value[key]);
  // Local artwork and arbitrary resource URLs never leave the device.
  out.coverUrl = value.source === 'netease' && typeof value.coverUrl === 'string' && /^https:\/\/[^/]+\.music\.126\.net\//.test(value.coverUrl) ? value.coverUrl.slice(0, 1500) : null;
  return out;
}
function statsData(value) {
  if (!value || typeof value !== 'object') fail('SYNC_INVALID');
  const tracks = {}, days = {}, artists = {};
  for (const [key, item] of Object.entries(value.tracks || {}).slice(0, 10000)) {
    if (!item || typeof item !== 'object') fail('SYNC_INVALID');
    Object.defineProperty(tracks, key.slice(0, 1500), { enumerable: true, value: {
      key: key.slice(0, 1500), title: string(item.title) || 'Unknown', artist: string(item.artist) || 'Unknown',
      plays: number(item.plays) || 0, ms: number(item.ms) || 0, lastPlayed: number(item.lastPlayed) || 0,
    } });
  }
  for (const [key, v] of Object.entries(value.days || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(key)) days[key] = number(v) || 0;
  for (const [key, v] of Object.entries(value.artists || {}).slice(0, 10000)) Object.defineProperty(artists, key.slice(0,500), { enumerable: true, value: number(v) || 0 });
  return { totalMs: number(value.totalMs) || 0, days, tracks, artists };
}
function normalize(op) {
  if (!op || !identifier(op.id)) fail('SYNC_INVALID');
  const out = { id: op.id, type: op.type };
  if (['playlist.put','playlist.delete','entry.put','entry.delete'].includes(op.type)) {
    if (!identifier(op.playlistId)) fail('SYNC_INVALID'); out.playlistId = op.playlistId;
  }
  if (['entry.put','entry.delete'].includes(op.type)) {
    if (!identifier(op.entryId)) fail('SYNC_INVALID'); out.entryId = op.entryId;
  }
  switch (op.type) {
    case 'playlist.put':
      if (!['temp','folder','netease'].includes(op.data?.kind)) fail('SYNC_INVALID');
      out.data = { name: string(op.data.name) || 'Playlist', kind: op.data.kind, neteaseId: number(op.data.neteaseId) }; break;
    case 'entry.put': out.data = trackData(op.data); break;
    case 'playlist.delete': case 'entry.delete': break;
    case 'stats.add':
      if (!identifier(op.epoch) || !/^\d{4}-\d{2}-\d{2}$/.test(op.data?.day || '')) fail('SYNC_INVALID');
      out.epoch = op.epoch;
      out.data = { key: string(op.data.key, 1500), title: string(op.data.title), artist: string(op.data.artist),
        day: op.data.day, ms: Math.min(60000, number(op.data.ms) || 0), plays: Math.min(1, Math.floor(number(op.data.plays) || 0)), lastPlayed: number(op.data.lastPlayed) || 0 };
      if (!out.data.key) fail('SYNC_INVALID'); break;
    case 'stats.clear':
      if (!identifier(op.epoch) || !identifier(op.nextEpoch)) fail('SYNC_INVALID');
      out.epoch = op.epoch; out.nextEpoch = op.nextEpoch; break;
    case 'stats.import':
      if (!identifier(op.epoch) || !identifier(op.importId)) fail('SYNC_INVALID');
      out.epoch = op.epoch; out.importId = op.importId; out.data = statsData(op.data); break;
    default: fail('SYNC_INVALID');
  }
  return out;
}
async function snapshot(tx, userId, epoch) {
  const playlists = (await tx.query('SELECT id,data FROM lumen_playlists WHERE user_id=$1 AND NOT deleted ORDER BY position', [userId])).rows;
  const entries = (await tx.query('SELECT e.id,e.playlist_id,e.data FROM lumen_entries e JOIN lumen_playlists p ON p.user_id=e.user_id AND p.id=e.playlist_id WHERE e.user_id=$1 AND NOT e.deleted AND NOT p.deleted ORDER BY e.position', [userId])).rows;
  const events = (await tx.query('SELECT data FROM lumen_stat_events WHERE user_id=$1 AND epoch=$2', [userId,epoch])).rows.map(r => r.data);
  return { playlists: playlists.map(p => ({ ...p.data, id:p.id, tracks:entries.filter(e => e.playlist_id===p.id).map(e => ({ ...e.data,id:e.id })) })), events, epoch };
}
async function synchronize(db, userId, body) {
  if (!Number.isSafeInteger(body.cursor) || body.cursor < 0 || !Array.isArray(body.operations) || body.operations.length > 100) fail('SYNC_INVALID');
  const operations = body.operations.map(normalize);
  return db.transaction(async tx => {
    await tx.query('INSERT INTO lumen_sync_state(user_id) VALUES($1) ON CONFLICT DO NOTHING',[userId]);
    const state = (await tx.query('SELECT cursor,stats_epoch FROM lumen_sync_state WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
    let cursor = Number(state.cursor), epoch = state.stats_epoch;
    const acknowledged = [];
    // Leave time for the snapshot and COMMIT within the function deadline.
    // Only acknowledge processed operations; clients retain and retry the rest.
    const deadline = Date.now() + 8000;
    for (const op of operations) {
      if (acknowledged.length && Date.now() >= deadline) break;
      acknowledged.push(op.id);
      if ((await tx.query('SELECT id FROM lumen_operations WHERE user_id=$1 AND id=$2',[userId,op.id])).rows.length) continue;
      cursor++;
      let applied = true;
      if (op.type === 'playlist.put') {
        const r = await tx.query('INSERT INTO lumen_playlists(user_id,id,data,position) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,id) DO UPDATE SET data=EXCLUDED.data WHERE NOT lumen_playlists.deleted RETURNING id',[userId,op.playlistId,op.data,cursor]); applied = !!r.rows.length;
      } else if (op.type === 'playlist.delete') {
        await tx.query("INSERT INTO lumen_playlists(user_id,id,data,position,deleted) VALUES($1,$2,'{}',$3,true) ON CONFLICT(user_id,id) DO UPDATE SET deleted=true",[userId,op.playlistId,cursor]);
      } else if (op.type.startsWith('entry.')) {
        const p = (await tx.query('SELECT deleted FROM lumen_playlists WHERE user_id=$1 AND id=$2',[userId,op.playlistId])).rows[0];
        if (!p || p.deleted) applied = false;
        else if (op.type === 'entry.put') {
          const r = await tx.query('INSERT INTO lumen_entries(user_id,id,playlist_id,data,position) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,id) DO UPDATE SET data=EXCLUDED.data WHERE NOT lumen_entries.deleted AND lumen_entries.playlist_id=EXCLUDED.playlist_id RETURNING id',[userId,op.entryId,op.playlistId,op.data,cursor]); applied = !!r.rows.length;
        } else {
          await tx.query("INSERT INTO lumen_entries(user_id,id,playlist_id,data,position,deleted) VALUES($1,$2,$3,'{}',$4,true) ON CONFLICT(user_id,id) DO UPDATE SET deleted=true WHERE lumen_entries.playlist_id=EXCLUDED.playlist_id",[userId,op.entryId,op.playlistId,cursor]);
        }
      } else if (op.epoch !== epoch) applied = false;
      else if (op.type === 'stats.clear') epoch = op.nextEpoch;
      else {
        if (op.type === 'stats.import') {
          const inserted = await tx.query('INSERT INTO lumen_imports(user_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',[userId,op.importId]); applied = !!inserted.rows.length;
        }
        if (applied) await tx.query('INSERT INTO lumen_stat_events(user_id,id,epoch,data) VALUES($1,$2,$3,$4)',[userId,op.id,epoch,op]);
      }
      await tx.query('INSERT INTO lumen_operations(user_id,id,cursor,data) VALUES($1,$2,$3,$4)',[userId,op.id,cursor,applied ? op : { id:op.id,type:'noop' }]);
    }
    await tx.query('UPDATE lumen_sync_state SET cursor=$2,stats_epoch=$3 WHERE user_id=$1',[userId,cursor,epoch]);
    if (body.cursor === 0 || body.cursor > cursor) return { acknowledged, cursor, snapshot: await snapshot(tx,userId,epoch), changes:[], hasMore:false };
    const rows = (await tx.query('SELECT cursor,data FROM lumen_operations WHERE user_id=$1 AND cursor>$2 ORDER BY cursor LIMIT 500',[userId,body.cursor])).rows;
    const delivered = rows.length ? Number(rows.at(-1).cursor) : cursor;
    return { acknowledged,cursor:delivered,changes:rows.map(r=>r.data),hasMore:delivered<cursor };
  });
}
module.exports = { synchronize, trackData, statsData };
