// データアクセス層。Supabase 版とデモ（localStorage）版を同じインターフェースで提供する。
import { CONFIG } from './config.js';
import { compressImage, extFromType, blobToDataUrl } from './image.js';

const SIGNED_URL_TTL = 60 * 60 * 12; // 署名付きURLの有効期限（秒）

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function cleanFields(f) {
  return {
    description: f.description ?? '',
    countries: Array.from(f.countries ?? []),
    area: f.area ?? '',
    notes: f.notes ?? '',
    category_id: f.category_id || null,
  };
}

// 初期カテゴリー（デモモード用。Supabase では setup.sql で投入）
export const DEFAULT_CATEGORIES = [
  ['ボラード', '#e03131'], ['シェブロン', '#f59f00'], ['道路標識', '#1c7ed6'], ['道路標示・ライン', '#74b816'],
  ['ナンバープレート', '#7048e8'], ['電柱', '#795548'], ['言語・文字', '#d6336c'], ['建物・街並み', '#1098ad'],
  ['自然・植生', '#2f9e44'], ['Googleカー・カメラ', '#868e96'], ['その他', '#4263eb'],
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

    async loginEditor(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(translateAuthError(error));
    },

    async logout() {
      urlCache.clear();
      await sb.auth.signOut();
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
        .map((c) => c.image_path)
        .filter((p) => { const hit = urlCache.get(p); return !hit || now - hit.at > (SIGNED_URL_TTL - 3600) * 1000; });
      for (let i = 0; i < need.length; i += 200) {
        const chunk = need.slice(i, i + 200);
        const { data, error } = await bucket().createSignedUrls(chunk, SIGNED_URL_TTL);
        if (error) throw error;
        for (const row of data) if (row.signedUrl) urlCache.set(row.path, { url: row.signedUrl, at: now });
      }
      return new Map(cards.map((c) => [c.id, urlCache.get(c.image_path)?.url || '']));
    },

    async createCard(fields, imageBlob) {
      const id = uuid();
      const blob = await compressImage(imageBlob);
      const path = `${id}.${extFromType(blob.type)}`;
      const up = await bucket().upload(path, blob, { contentType: blob.type, upsert: false });
      if (up.error) throw up.error;
      const { error } = await sb.from('cards').insert({ id, image_path: path, ...cleanFields(fields) });
      if (error) {
        await bucket().remove([path]);
        throw error;
      }
    },

    async updateCard(card, fields, imageBlob) {
      const patch = { ...cleanFields(fields), updated_at: new Date().toISOString() };
      let oldPath = null;
      if (imageBlob) {
        const blob = await compressImage(imageBlob);
        const path = `${card.id}-${Date.now()}.${extFromType(blob.type)}`;
        const up = await bucket().upload(path, blob, { contentType: blob.type, upsert: false });
        if (up.error) throw up.error;
        patch.image_path = path;
        oldPath = card.image_path;
      }
      const { error } = await sb.from('cards').update(patch).eq('id', card.id);
      if (error) {
        if (patch.image_path) await bucket().remove([patch.image_path]);
        throw error;
      }
      if (oldPath) { await bucket().remove([oldPath]); urlCache.delete(oldPath); }
    },

    // チャット形式のメモ（古い順）
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

    // 国ごとのメモ: Map(code -> note)
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

    async deleteCategory(id) {
      const { error } = await sb.from('categories').delete().eq('id', id);
      if (error) throw error;
    },

    async deleteCard(card) {
      const { error } = await sb.from('cards').delete().eq('id', card.id);
      if (error) throw error;
      await bucket().remove([card.image_path]);
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
    async listCards() {
      return load().sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async imageUrls(cards) { return new Map(cards.map((c) => [c.id, c.image_path])); },
    async createCard(fields, imageBlob) {
      const blob = await compressImage(imageBlob, 1000, 0.75);
      const cards = load();
      const now = new Date().toISOString();
      cards.push({ id: uuid(), image_path: await blobToDataUrl(blob), ...cleanFields(fields), created_at: now, updated_at: now });
      save(cards);
    },
    async updateCard(card, fields, imageBlob) {
      const cards = load();
      const c = cards.find((x) => x.id === card.id);
      if (!c) throw new Error('カードが見つかりません');
      Object.assign(c, cleanFields(fields), { updated_at: new Date().toISOString() });
      if (imageBlob) c.image_path = await blobToDataUrl(await compressImage(imageBlob, 1000, 0.75));
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
