// 対戦のボイスチャット: WebRTC で、参加者どうしを直接つなぐ（音声は、サーバーを通らない）。
// つなぐための情報（offer / answer / ICE）は、対戦の通信（Realtime の Broadcast）で、{ t: 'vc', … } として送りあう。
// 経路の確認には、公開の STUN サーバーだけを使う（TURN は使わない）ので、厳しいネットワーク（一部の会社・学校・携帯回線）では、つながらないことがある。
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

/** send(m): 全員へ送る / meId: 自分の id / host: 音声の <audio> を置く要素 / onChange(): 状態が変わったとき */
export function createVoice({ send, meId, host, onChange }) {
  const pcs = new Map(); // 相手の id → { pc, audio, pending: [ICE の候補], state }
  let stream = null;
  let on = false;
  let muted = false;
  let busy = false;
  const emit = () => { try { onChange?.(); } catch { /* 無視 */ } };
  const to = (id, op, extra = {}) => send({ t: 'vc', op, from: meId, to: id, ...extra });

  function drop(id) {
    const p = pcs.get(id);
    if (!p) return;
    pcs.delete(id);
    try { p.pc.close(); } catch { /* 無視 */ }
    p.audio?.remove();
    emit();
  }

  function link(id) {
    let p = pcs.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    p = { pc, audio: null, pending: [], state: 'connecting' };
    pcs.set(id, p);
    for (const tr of stream.getTracks()) pc.addTrack(tr, stream);
    pc.onicecandidate = (e) => { if (e.candidate) to(id, 'ice', { c: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (!p.audio) {
        p.audio = document.createElement('audio');
        p.audio.autoplay = true;
        p.audio.playsInline = true;
        host.appendChild(p.audio);
      }
      p.audio.srcObject = e.streams[0];
      p.audio.play?.().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      p.state = pc.connectionState;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { if (pcs.get(id) === p) drop(id); } else emit();
    };
    emit();
    return p;
  }

  async function offerTo(id) {
    const { pc } = link(id);
    await pc.setLocalDescription(await pc.createOffer());
    to(id, 'offer', { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
  }

  // 相手が通話に入っている（join / here）と分かったとき: id の小さい方が offer を出す（同時に出し合わないように）
  function meet(id) {
    if (pcs.has(id)) return;
    if (meId < id) offerTo(id).catch(() => drop(id)); else to(id, 'need');
  }

  async function onMsg(m) {
    if (m.t !== 'vc' || m.from === meId || !on) return;
    if (m.to && m.to !== meId) return;
    const id = m.from;
    try {
      if (m.op === 'join') { to(id, 'here'); meet(id); }
      else if (m.op === 'here') meet(id);
      else if (m.op === 'need') { if (!pcs.has(id)) await offerTo(id); }
      else if (m.op === 'offer') {
        drop(id);
        const p = link(id);
        await p.pc.setRemoteDescription(m.sdp);
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        to(id, 'answer', { sdp: { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp } });
      } else if (m.op === 'answer') {
        const p = pcs.get(id);
        if (p && !p.pc.currentRemoteDescription) {
          await p.pc.setRemoteDescription(m.sdp);
          for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        }
      } else if (m.op === 'ice') {
        const p = pcs.get(id);
        if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.c).catch(() => {}); else p.pending.push(m.c);
      } else if (m.op === 'leave') drop(id);
    } catch { drop(id); }
  }

  async function start() {
    if (on || busy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('このブラウザでは、ボイスチャットを使えません');
    busy = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e) {
      throw new Error(e?.name === 'NotAllowedError' ? 'マイクの使用が許可されていません（ブラウザの設定で許可してください）' : 'マイクを使えませんでした');
    } finally { busy = false; }
    on = true; muted = false;
    send({ t: 'vc', op: 'join', from: meId });
    emit();
  }

  function stop() {
    if (!on) return;
    on = false;
    send({ t: 'vc', op: 'leave', from: meId });
    for (const id of [...pcs.keys()]) drop(id);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    emit();
  }

  function setMuted(v) {
    muted = !!v;
    stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    emit();
  }

  return {
    start, stop, onMsg, setMuted,
    get on() { return on; },
    get muted() { return muted; },
    count: () => [...pcs.values()].filter((p) => p.state === 'connected').length,
    total: () => pcs.size,
    /** 部屋にいない人の接続を片付ける */
    prune: (ids) => { for (const id of [...pcs.keys()]) if (!ids.has(id)) drop(id); },
  };
}
