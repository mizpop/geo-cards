// データアクセス層。Supabase 版とデモ（localStorage）版を同じインターフェースで提供する。
import { CONFIG } from './config.js';
import { compressImage, makeThumb, extFromType, blobToDataUrl } from './image.js';

const SIGNED_URL_TTL = 60 * 60 * 12; // 署名付きURLの有効期限（秒）

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// 保存したストリートビューの項目（座標と地名だけを通す）
function cleanSv(f) {
  const out = {};
  for (const k of ['lat', 'lng']) if (f[k] !== undefined) out[k] = Number(f[k]);
  for (const k of ['heading', 'pitch', 'fov']) if (f[k] !== undefined && Number.isFinite(Number(f[k]))) out[k] = Number(f[k]); // 向き・傾き・視野（ズーム）
  for (const k of ['code', 'title', 'name', 'name_en', 'name_local', 'admin', 'note']) if (f[k] !== undefined) out[k] = String(f[k] ?? '').slice(0, 300);
  return out;
}

function cleanFields(f) {
  const out = {
    description: f.description ?? '',
    countries: Array.from(f.countries ?? []),
    area: f.area ?? '',
    notes: f.notes ?? '',
    category_id: f.category_id || null,
  };
  // 関連カード（card-extras.sql で追加した列）。使っていないときは送らない（列がまだなくても保存できるように）
  if (f.related) out.related = Array.from(f.related);
  // 地名（都市・町。card-extras.sql で追加した列。使っていないときは送らない）
  if (f.places) out.places = Array.from(f.places);
  // 関連付けた保存済みストリートビューの id（card-extras.sql で追加した列。使っていないときは送らない）
  if (f.sv_ids) out.sv_ids = Array.from(f.sv_ids);
  // ナンバープレートをぼかす範囲（card-extras.sql で追加した列。使っていないときは送らない）
  if (f.blur) out.blur = f.blur;
  return out;
}

// thumb_path の列がまだない（card-extras.sql を実行前）ときのエラーか
const isThumbColumnError = (error) => /thumb_path/.test(error?.message || '') && /(column|schema cache)/i.test(error?.message || '');

// progress-sync.sql をまだ実行していない（関数がない）ときのエラーを分かりやすく
function explainSyncError(error) {
  const msg = error?.message || '';
  if (/(sync_get|sync_put)/.test(msg) && /(not find|does not exist|schema cache)/i.test(msg)) return new Error('同期の準備ができていません。Supabase の SQL Editor で supabase/progress-sync.sql を実行してください');
  return error;
}

// card-extras.sql をまだ実行していない（列がない）ときのエラーを分かりやすく
function explainColumnError(error) {
  const msg = error?.message || '';
  if (/(related|back_path|places|sv_ids|blur)/.test(msg) && /(column|schema cache)/i.test(msg)) {
    return new Error('データベースに新しい列がありません。Supabase の SQL Editor で supabase/card-extras.sql を実行してください');
  }
  return error;
}

// 初期カテゴリー（デモモード用。Supabase では setup.sql で投入）
export const DEFAULT_CATEGORIES = [
  ['ボラード', '#e03131'], ['シェブロン', '#f59f00'], ['道路標識', '#1c7ed6'], ['道路標示・ライン', '#74b816'],
  ['ナンバープレート', '#7048e8'], ['電柱', '#795548'], ['言語・文字', '#d6336c'], ['建物・街並み', '#1098ad'],
  ['自然・植生', '#2f9e44'], ['Googleカー・カメラ', '#868e96'], ['国旗', '#ae3ec9'], ['その他', '#4263eb'],
];

function translateAuthError(error) {
  const msg = error?.message || String(error);
  if (/invalid login credentials/i.test(msg)) return 'パスワード（またはメールアドレス）が違います';
  if (/email not confirmed/i.test(msg)) return 'メールアドレスが未確認です。Supabase でユーザーを確認済みにしてください';
  if (/rate limit|too many/i.test(msg)) return '試行回数が多すぎます。しばらく待ってから再度お試しください';
  return msg;
}

/* ---------------- Supabase 版 ---------------- */
function createSupabaseApi(sb) {
  const bucket = () => sb.storage.from(CONFIG.BUCKET);
  const urlCache = new Map(); // image_path -> { url, at }
  let thumbsUnsupported = false; // thumb_path の列がまだない（card-extras.sql 実行前）

  async function currentUser() {
    const { data } = await sb.auth.getSession();
    return data.session?.user ?? null;
  }

  return {
    mode: 'supabase',

    async getUser() {
      const user = await currentUser();
      if (!user) return null;
      const { data } = await sb.from('editors').select('user_id').eq('user_id', user.id).maybeSingle();
      return { id: user.id, email: user.email, isEditor: !!data, isViewer: user.email === CONFIG.VIEWER_EMAIL };
    },

    async loginViewer(password) {
      const { error } = await sb.auth.signInWithPassword({ email: CONFIG.VIEWER_EMAIL, password });
      if (error) throw new Error(translateAuthError(error));
    },

    async loginEditor(password) { // メールアドレスは固定（config.js の EDITOR_EMAIL）。パスワードだけ入力する
      const { error } = await sb.auth.signInWithPassword({ email: CONFIG.EDITOR_EMAIL, password });
      if (error) throw new Error(translateAuthError(error));
    },

    async logout() {
      urlCache.clear();
      await sb.auth.signOut();
    },

    // ログイン中のアクセストークン（AI アシスタントのサーバー側が、ログインしている人かを確かめるのに使う）
    async getAccessToken() {
      const { data } = await sb.auth.getSession();
      return data.session?.access_token || '';
    },

    async listCards() {
      const all = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('cards').select('*')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all.push(...data);
        if (data.length < PAGE) break;
      }
      return all;
    },

    // cards の画像URLを Map(card.id -> url) で返す
    async imageUrls(cards) {
      const now = Date.now();
      const need = cards
        .flatMap((c) => [c.image_path, c.back_path, c.thumb_path].filter(Boolean))
        .filter((p) => { const hit = urlCache.get(p); return !hit || now - hit.at > (SIGNED_URL_TTL - 3600) * 1000; });
      for (let i = 0; i < need.length; i += 200) {
        const chunk = need.slice(i, i + 200);
        const { data, error } = await bucket().createSignedUrls(chunk, SIGNED_URL_TTL);
        if (error) throw error;
        for (const row of data) if (row.signedUrl) urlCache.set(row.path, { url: row.signedUrl, at: now });
      }
      // 裏面だけのレイヤーは「id|back」で
      return new Map(cards.flatMap((c) => [[c.id, urlCache.get(c.image_path)?.url || ''],
        ...(c.back_path ? [[`${c.id}|back`, urlCache.get(c.back_path)?.url || '']] : []),
        ...(c.thumb_path ? [[`${c.id}|thumb`, urlCache.get(c.thumb_path)?.url || '']] : [])]));
    },

    // backBlob: 裏面だけに表示する書き込みのレイヤー（透明な画像）
    async createCard(fields, imageBlob, backBlob = null) {
      const id = uuid();
      const blob = await compressImage(imageBlob);
      const path = `${id}.${extFromType(blob.type)}`;
      const up = await bucket().upload(path, blob, { contentType: blob.type, upsert: false });
      if (up.error) throw up.error;
      const row = { id, image_path: path, ...cleanFields(fields) };
      if (!row.related?.length) delete row.related;
      if (!row.places?.length) delete row.places;
      if (!row.blur?.length) delete row.blur;
      if (!row.sv_ids?.length) delete row.sv_ids;
      const uploaded = [path];
      // 一覧・地図用の低画質版（失敗しても本体の保存は続ける）
      let thumbPath = null;
      if (!thumbsUnsupported) {
        try {
          const tb = await makeThumb(imageBlob);
          const tp = `${id}-t.${extFromType(tb.type)}`;
          const ut = await bucket().upload(tp, tb, { contentType: tb.type, upsert: false });
          if (!ut.error) { thumbPath = tp; row.thumb_path = tp; uploaded.push(tp); }
        } catch { /* 低画質版なしで続行 */ }
      }
      if (backBlob instanceof Blob) {
        const bb = await compressImage(backBlob);
        row.back_path = `${id}-back-${Date.now()}.${extFromType(bb.type)}`;
        const ub = await bucket().upload(row.back_path, bb, { contentType: bb.type, upsert: false });
        if (ub.error) { await bucket().remove(uploaded); throw ub.error; }
        uploaded.push(row.back_path);
      }
      let { error } = await sb.from('cards').insert(row);
      if (error && thumbPath && isThumbColumnError(error)) { // 列がまだない: 低画質版なしで保存し直す
        thumbsUnsupported = true;
        await bucket().remove([thumbPath]);
        uploaded.splice(uploaded.indexOf(thumbPath), 1);
        delete row.thumb_path;
        ({ error } = await sb.from('cards').insert(row));
      }
      if (error) {
        await bucket().remove(uploaded);
        throw explainColumnError(error);
      }
    },

    // back: 裏面だけのレイヤー。null なら変更なし、'clear' なら削除、Blob なら差し替え
    async updateCard(card, fields, imageBlob, back = null) {
      const patch = { ...cleanFields(fields), updated_at: new Date().toISOString() };
      if (!patch.related?.length && !card.related?.length) delete patch.related;
      if (!patch.places?.length && !card.places?.length) delete patch.places;
      if (!patch.blur?.length && !card.blur?.length) delete patch.blur;
      if (!patch.sv_ids?.length && !card.sv_ids?.length) delete patch.sv_ids;
      const added = [];
      const old = [];
      if (imageBlob) {
        const blob = await compressImage(imageBlob);
        const path = `${card.id}-${Date.now()}.${extFromType(blob.type)}`;
        const up = await bucket().upload(path, blob, { contentType: blob.type, upsert: false });
        if (up.error) throw up.error;
        patch.image_path = path;
        added.push(path);
        old.push(card.image_path);
        if (!thumbsUnsupported) {
          try {
            const tb = await makeThumb(imageBlob);
            const tp = `${card.id}-t-${Date.now()}.${extFromType(tb.type)}`;
            const ut = await bucket().upload(tp, tb, { contentType: tb.type, upsert: false });
            if (!ut.error) { patch.thumb_path = tp; added.push(tp); if (card.thumb_path) old.push(card.thumb_path); }
          } catch { /* 低画質版なしで続行 */ }
        }
      }
      if (back instanceof Blob) {
        const bb = await compressImage(back);
        const path = `${card.id}-back-${Date.now()}.${extFromType(bb.type)}`;
        const up = await bucket().upload(path, bb, { contentType: bb.type, upsert: false });
        if (up.error) { if (added.length) await bucket().remove(added); throw up.error; }
        patch.back_path = path;
        added.push(path);
        if (card.back_path) old.push(card.back_path);
      } else if (back === 'clear' && card.back_path) {
        patch.back_path = null;
        old.push(card.back_path);
      }
      let { error } = await sb.from('cards').update(patch).eq('id', card.id);
      if (error && patch.thumb_path && isThumbColumnError(error)) { // 列がまだない: 低画質版なしで保存し直す
        thumbsUnsupported = true;
        await bucket().remove([patch.thumb_path]);
        added.splice(added.indexOf(patch.thumb_path), 1);
        if (card.thumb_path) old.splice(old.indexOf(card.thumb_path), 1);
        delete patch.thumb_path;
        ({ error } = await sb.from('cards').update(patch).eq('id', card.id));
      }
      if (error) {
        if (added.length) await bucket().remove(added);
        throw explainColumnError(error);
      }
      if (old.length) { await bucket().remove(old); for (const p of old) urlCache.delete(p); }
    },

    // チャット形式のメモ（古い順）
    // 保存したストリートビュー
    async listSavedSv() {
      const { data, error } = await sb.from('saved_streetviews').select('*').order('created_at', { ascending: false }).limit(1000);
      if (error) throw new Error(/saved_streetviews/.test(error.message || '') ? '保存したストリートビューの表を作る必要があります（supabase/card-extras.sql を実行してください）' : error.message);
      return data;
    },
    async addSavedSv(fields) {
      let { data, error } = await sb.from('saved_streetviews').insert(cleanSv(fields)).select('*').single();
      if (error && /heading|pitch|fov|title/.test(error.message || '')) { // 向き・ズーム・名前の列がまだ無いとき（SQL 実行前）は、それらを除いて保存する
        const { heading, pitch, fov, title, ...rest } = cleanSv(fields);
        ({ data, error } = await sb.from('saved_streetviews').insert(rest).select('*').single());
      }
      if (error) throw new Error(/saved_streetviews/.test(error.message || '') ? '保存したストリートビューの表を作る必要があります（supabase/card-extras.sql を実行してください）' : error.message);
      return data;
    },
    async updateSavedSv(id, fields) {
      const { data, error } = await sb.from('saved_streetviews').update(cleanSv(fields)).eq('id', id).select('*').single();
      if (error) throw new Error(/heading|pitch|fov|title/.test(error.message || '') ? '名前・向き・ズームの列を作る必要があります（supabase/card-extras.sql を実行してください）' : error.message);
      return data;
    },
    async deleteSavedSv(id) {
      const { error } = await sb.from('saved_streetviews').delete().eq('id', id);
      if (error) throw error;
    },
    async listMemos() {
      const { data, error } = await sb.from('memos').select('id, user_id, author, body, created_at')
        .order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      return data.reverse();
    },
    async addMemo(body, author) {
      const { data, error } = await sb.from('memos').insert({ body, author }).select('id, user_id, author, body, created_at').single();
      if (error) throw error;
      return data;
    },
    async deleteMemo(id) {
      const { error } = await sb.from('memos').delete().eq('id', id);
      if (error) throw error;
    },
    // 誰かがメモを書いた・消したら即座に通知（Supabase Realtime）。戻り値は購読解除の関数
    subscribeMemos(handler) {
      const ch = sb.channel('memos-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'memos' }, (p) => handler(p.eventType, p.new, p.old))
        .subscribe();
      return () => sb.removeChannel(ch);
    },
    // カード・カテゴリー・国のメモが誰かに変更されたら通知（Supabase Realtime）。戻り値は購読解除の関数
    subscribeCards(handler) {
      const ch = sb.channel('cards-changes');
      for (const table of ['cards', 'categories', 'country_notes', 'country_facts', 'saved_streetviews']) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => handler(table));
      }
      ch.subscribe();
      return () => sb.removeChannel(ch);
    },

    // 公開された対戦の部屋のお知らせ用の共通チャンネル（全員が受信。Broadcast のみ）
    async openLobby(on) {
      const ch = sb.channel('battle-lobby', { config: { broadcast: { self: false } } });
      ch.on('broadcast', { event: 'm' }, ({ payload }) => on(payload));
      ch.subscribe();
      return { send: (payload) => ch.send({ type: 'broadcast', event: 'm', payload }), leave: () => sb.removeChannel(ch) };
    },
    // リアルタイム対戦の通信（Supabase Realtime の Broadcast / Presence。テーブルは使わない）。on.msg: メッセージ受信、on.presence: 今いる人の一覧
    async battleChannel(room, me, on) {
      const ch = sb.channel(`battle:${room}`, { config: { broadcast: { self: true }, presence: { key: me.id } } });
      ch.on('broadcast', { event: 'm' }, ({ payload }) => on.msg(payload));
      ch.on('presence', { event: 'sync' }, () => on.presence(Object.values(ch.presenceState()).map((a) => a[0]).filter(Boolean)));
      await new Promise((resolve, reject) => ch.subscribe((st) => { if (st === 'SUBSCRIBED') resolve(); else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') reject(new Error('対戦の通信に接続できませんでした')); }));
      await ch.track({ ...me });
      return { send: (payload) => ch.send({ type: 'broadcast', event: 'm', payload }), setMe: (info) => ch.track(info), leave: () => sb.removeChannel(ch) };
    },
    // 国ごとのメモ: Map(code -> note)
    // 国ごとの情報（地図のインフォグラフィック）: Map(topic → Map(code → value))
    async listFacts() {
      const { data, error } = await sb.from('country_facts').select('code, topic, value');
      if (error) throw error;
      const m = new Map();
      for (const r of data) { if (!m.has(r.topic)) m.set(r.topic, new Map()); m.get(r.topic).set(r.code, r.value); }
      return m;
    },
    async saveFact(code, topic, value) {
      const { error } = value
        ? await sb.from('country_facts').upsert({ code, topic, value, updated_at: new Date().toISOString() })
        : await sb.from('country_facts').delete().eq('code', code).eq('topic', topic);
      if (error) throw error;
    },
    async listCountryNotes() {
      const { data, error } = await sb.from('country_notes').select('code, note');
      if (error) throw error;
      return new Map(data.map((r) => [r.code, r.note]));
    },
    async saveCountryNote(code, note) {
      const { error } = note
        ? await sb.from('country_notes').upsert({ code, note, updated_at: new Date().toISOString() })
        : await sb.from('country_notes').delete().eq('code', code);
      if (error) throw error;
    },

    async listCategories() {
      const { data, error } = await sb.from('categories').select('*').order('sort').order('name');
      if (error) throw error;
      return data;
    },

    async saveCategory(cat) {
      const row = { name: cat.name, color: cat.color, sort: cat.sort ?? 0 };
      const { error } = cat.id
        ? await sb.from('categories').update(row).eq('id', cat.id)
        : await sb.from('categories').insert(row);
      if (error) throw error;
    },

    // 学習記録の端末間同期（引き継ぎコード）。supabase/progress-sync.sql の関数を呼ぶ
    async syncGet(code) {
      const { data, error } = await sb.rpc('sync_get', { p_code: code });
      if (error) throw explainSyncError(error);
      return data || null; // { data, updated_at } か null（まだない）
    },
    async syncPut(code, payload) {
      const { error } = await sb.rpc('sync_put', { p_code: code, p_data: payload });
      if (error) throw explainSyncError(error);
    },

    // 低画質版がまだないカードの分を作る（既存のカード用。1 枚ずつ元の画像を取得して小さくし、保存する）
    // onProgress(done, total)。戻り値: 作れた枚数
    async ensureThumbs(cards, onProgress = () => {}) {
      const todo = cards.filter((c) => !c.thumb_path && c.image_path);
      let done = 0;
      for (const c of todo) {
        try {
          const urls = await this.imageUrls([c]);
          const res = await fetch(urls.get(c.id));
          const tb = await makeThumb(await res.blob());
          const tp = `${c.id}-t.${extFromType(tb.type)}`;
          const up = await bucket().upload(tp, tb, { contentType: tb.type, upsert: true });
          if (up.error) throw up.error;
          const { error } = await sb.from('cards').update({ thumb_path: tp }).eq('id', c.id); // updated_at は変えない
          if (error) {
            await bucket().remove([tp]);
            if (isThumbColumnError(error)) throw new Error('データベースに thumb_path の列がありません。supabase/card-extras.sql を実行してください');
            throw error;
          }
          done++;
        } catch (ex) {
          if (/thumb_path/.test(ex.message)) throw ex;
          console.warn('低画質版を作れませんでした', c.id, ex);
        }
        onProgress(done, todo.length);
      }
      return done;
    },

    async deleteCategory(id) {
      const { error } = await sb.from('categories').delete().eq('id', id);
      if (error) throw error;
    },

    async deleteCard(card) {
      const { error } = await sb.from('cards').delete().eq('id', card.id);
      if (error) throw error;
      await bucket().remove([card.image_path, card.back_path, card.thumb_path].filter(Boolean));
      urlCache.delete(card.image_path);
    },
  };
}

/* ---------------- デモ版（このブラウザの localStorage のみ） ---------------- */
function createDemoApi() {
  const KEY = 'geo-cards-demo-v1';
  const CAT_KEY = 'geo-cards-demo-categories-v1';
  const NOTES_KEY = 'geo-cards-demo-country-notes-v1';
  const MEMOS_KEY = 'geo-cards-demo-memos-v1';
  const SAVED_SV_KEY = 'geo-cards-demo-saved-sv-v1';
  const FACTS_KEY = 'geo-cards-demo-facts-v1';
  const loadCats = () => {
    try {
      const v = JSON.parse(localStorage.getItem(CAT_KEY));
      if (v) return v;
    } catch { /* 初期化へ */ }
    const init = DEFAULT_CATEGORIES.map(([name, color], i) => ({ id: uuid(), name, color, sort: (i + 1) * 10 }));
    localStorage.setItem(CAT_KEY, JSON.stringify(init));
    return init;
  };
  const saveCats = (v) => localStorage.setItem(CAT_KEY, JSON.stringify(v));
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (cards) => {
    try { localStorage.setItem(KEY, JSON.stringify(cards)); }
    catch { throw new Error('ブラウザの保存容量が不足しています（デモモードは数十枚程度まで）'); }
  };

  return {
    mode: 'demo',
    async getUser() { return { id: 'demo', email: 'demo', isEditor: true, isViewer: false }; },
    async loginViewer() {},
    async loginEditor() {},
    async logout() {},
    async getAccessToken() { return ''; },
    async listCards() {
      return load().sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async imageUrls(cards) { return new Map(cards.flatMap((c) => [[c.id, c.image_path], ...(c.back_path ? [[`${c.id}|back`, c.back_path]] : []), ...(c.thumb_path ? [[`${c.id}|thumb`, c.thumb_path]] : [])])); },
    async ensureThumbs() { return 0; }, // デモは保存容量が小さいので、追加時に作った分だけ
    // 学習記録の同期のお試し用（本物のサーバーの代わりに、このブラウザの中に置く）
    async syncGet(code) { try { return JSON.parse(localStorage.getItem('geo-cards-demo-sync-v1'))?.[code] || null; } catch { return null; } },
    async syncPut(code, payload) {
      let all = {};
      try { all = JSON.parse(localStorage.getItem('geo-cards-demo-sync-v1')) || {}; } catch { /* 空 */ }
      all[code] = { data: payload, updated_at: new Date().toISOString() };
      localStorage.setItem('geo-cards-demo-sync-v1', JSON.stringify(all));
    },
    async createCard(fields, imageBlob, backBlob = null) {
      const image = await blobToDataUrl(await compressImage(imageBlob, 1000, 0.75));
      const backPath = backBlob instanceof Blob ? await blobToDataUrl(await compressImage(backBlob, 1000, 0.75)) : null;
      const thumb = await blobToDataUrl(await compressImage(imageBlob, 320, 0.55));
      // 読み込み〜保存の間に await を挟まない（並行して追加したときに上書きし合わないように）
      const cards = load();
      const now = new Date().toISOString();
      cards.push({ id: uuid(), image_path: image, back_path: backPath, thumb_path: thumb, ...cleanFields(fields), created_at: now, updated_at: now });
      save(cards);
    },
    async updateCard(card, fields, imageBlob, back = null) {
      const image = imageBlob ? await blobToDataUrl(await compressImage(imageBlob, 1000, 0.75)) : null;
      const backPath = back instanceof Blob ? await blobToDataUrl(await compressImage(back, 1000, 0.75)) : null;
      const thumb = imageBlob ? await blobToDataUrl(await compressImage(imageBlob, 320, 0.55)) : null;
      const cards = load();
      const c = cards.find((x) => x.id === card.id);
      if (!c) throw new Error('カードが見つかりません');
      Object.assign(c, cleanFields(fields), { updated_at: new Date().toISOString() });
      if (image) { c.image_path = image; c.thumb_path = thumb; }
      if (backPath) c.back_path = backPath;
      else if (back === 'clear') c.back_path = null;
      save(cards);
    },
    async deleteCard(card) {
      save(load().filter((x) => x.id !== card.id));
    },
    async listCategories() {
      return loadCats().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    },
    async listCountryNotes() {
      try { return new Map(Object.entries(JSON.parse(localStorage.getItem(NOTES_KEY)) || {})); } catch { return new Map(); }
    },
    async listFacts() {
      let raw = {};
      try { raw = JSON.parse(localStorage.getItem(FACTS_KEY)) || {}; } catch { /* 空 */ }
      return new Map(Object.entries(raw).map(([topic, v]) => [topic, new Map(Object.entries(v))]));
    },
    async saveFact(code, topic, value) {
      let raw = {};
      try { raw = JSON.parse(localStorage.getItem(FACTS_KEY)) || {}; } catch { /* 空 */ }
      raw[topic] = raw[topic] || {};
      if (value) raw[topic][code] = value; else delete raw[topic][code];
      try { localStorage.setItem(FACTS_KEY, JSON.stringify(raw)); } catch { throw new Error('ブラウザの保存容量が不足しています'); }
    },
    async listSavedSv() {
      try { return (JSON.parse(localStorage.getItem(SAVED_SV_KEY)) || []).sort((x, y) => (y.created_at || '').localeCompare(x.created_at || '')); } catch { return []; }
    },
    async addSavedSv(fields) {
      const list = await this.listSavedSv();
      const row = { id: uuid(), user_id: 'demo', created_at: new Date().toISOString(), ...cleanSv(fields) };
      list.push(row);
      try { localStorage.setItem(SAVED_SV_KEY, JSON.stringify(list)); } catch { throw new Error('ブラウザの保存容量が不足しています'); }
      return row;
    },
    async updateSavedSv(id, fields) {
      const list = await this.listSavedSv();
      const row = list.find((x) => x.id === id);
      if (!row) throw new Error('見つかりません');
      Object.assign(row, cleanSv(fields));
      localStorage.setItem(SAVED_SV_KEY, JSON.stringify(list));
      return row;
    },
    async deleteSavedSv(id) {
      localStorage.setItem(SAVED_SV_KEY, JSON.stringify((await this.listSavedSv()).filter((x) => x.id !== id)));
    },
    async listMemos() {
      try { return JSON.parse(localStorage.getItem(MEMOS_KEY)) || []; } catch { return []; }
    },
    async addMemo(body, author) {
      const memos = await this.listMemos();
      const row = { id: uuid(), user_id: 'demo', author, body, created_at: new Date().toISOString() };
      memos.push(row);
      try { localStorage.setItem(MEMOS_KEY, JSON.stringify(memos.slice(-500))); } catch { throw new Error('ブラウザの保存容量が不足しています'); }
      return row;
    },
    async deleteMemo(id) {
      const memos = (await this.listMemos()).filter((m) => m.id !== id);
      localStorage.setItem(MEMOS_KEY, JSON.stringify(memos));
    },
    // デモ: 同じブラウザの別タブでの変更を通知
    subscribeMemos(handler) {
      const onStorage = (e) => { if (e.key === MEMOS_KEY) handler('RELOAD'); };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
    async openLobby(on) {
      const bc = new BroadcastChannel('geo-battle-lobby');
      bc.onmessage = (e) => on(e.data);
      return { send: (m) => bc.postMessage(m), leave: () => bc.close() };
    },
    // リアルタイム対戦の通信（デモモード: 同じブラウザの別タブどうし。BroadcastChannel で代用）
    async battleChannel(room, me, on) {
      const bc = new BroadcastChannel(`geo-battle-${room}`);
      const peers = new Map([[me.id, { ...me, seen: Date.now() }]]);
      let sig = '';
      const emit = () => { // 顔ぶれが変わったときだけ通知（毎秒描き直さないように）
        for (const [id, p] of peers) if (Date.now() - p.seen > 3500) peers.delete(id);
        const list = [...peers.values()].map(({ seen, ...p }) => p);
        const s = JSON.stringify(list);
        if (s !== sig) { sig = s; on.presence(list); }
      };
      const hello = () => bc.postMessage({ hello: { ...me } });
      bc.onmessage = (e) => {
        if (e.data.hello) { const known = peers.has(e.data.hello.id); peers.set(e.data.hello.id, { ...e.data.hello, seen: Date.now() }); if (!known) hello(); emit(); }
        else if (e.data.bye) { peers.delete(e.data.bye); emit(); }
        else if (e.data.m) on.msg(e.data.m);
      };
      const beat = setInterval(() => { peers.get(me.id).seen = Date.now(); hello(); emit(); }, 1000);
      hello();
      setTimeout(emit, 50);
      return {
        send: (m) => { bc.postMessage({ m }); setTimeout(() => on.msg(m), 0); },
        setMe: (info) => { Object.assign(me, info); peers.set(me.id, { ...me, seen: Date.now() }); hello(); emit(); },
        leave: () => { clearInterval(beat); bc.postMessage({ bye: me.id }); bc.close(); },
      };
    },
    subscribeCards(handler) {
      const keys = { [KEY]: 'cards', [CAT_KEY]: 'categories', [NOTES_KEY]: 'country_notes', [FACTS_KEY]: 'country_facts', [SAVED_SV_KEY]: 'saved_streetviews' };
      const onStorage = (e) => { if (keys[e.key]) handler(keys[e.key]); };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
    async saveCountryNote(code, note) {
      const all = Object.fromEntries(await this.listCountryNotes());
      if (note) all[code] = note; else delete all[code];
      try { localStorage.setItem(NOTES_KEY, JSON.stringify(all)); } catch { throw new Error('ブラウザの保存容量が不足しています'); }
    },
    async saveCategory(cat) {
      const cats = loadCats();
      const row = { name: cat.name, color: cat.color, sort: cat.sort ?? 0 };
      if (cat.id) Object.assign(cats.find((c) => c.id === cat.id) || {}, row);
      else cats.push({ id: uuid(), ...row });
      saveCats(cats);
    },
    async deleteCategory(id) {
      saveCats(loadCats().filter((c) => c.id !== id));
      const cards = load();
      for (const c of cards) if (c.category_id === id) c.category_id = null;
      save(cards);
    },
  };
}

export async function initApi() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) return createDemoApi();
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return createSupabaseApi(sb);
}
