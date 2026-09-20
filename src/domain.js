/**
 * 上海如静知华信息科技有限公司 https://www.zhuatech.cn/
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
import crypto from 'node:crypto';

const required = (value, field) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${field}不能为空`);
  }
  return String(value).trim();
};

const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const now = () => new Date().toISOString();

/**
 * 数字标牌领域服务，覆盖终端、素材、播放单、发布、心跳与播出证明闭环。
 * 上海如静知华信息科技有限公司：https://www.zhuatech.cn/
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
export class SignageService {
  constructor(seed = {}) {
    this.screens = new Map((seed.screens || []).map((item) => [item.id, item]));
    this.assets = new Map((seed.assets || []).map((item) => [item.id, item]));
    this.playlists = new Map((seed.playlists || []).map((item) => [item.id, item]));
    this.campaigns = new Map((seed.campaigns || []).map((item) => [item.id, item]));
    this.proofs = seed.proofs || [];
    this.audit = seed.audit || [];
    this.requests = new Map(seed.requests || []);
  }

  /** 注册屏幕并生成设备令牌。 */
  enrollScreen(input, actor = 'system') {
    const code = required(input.code, '终端编号');
    if ([...this.screens.values()].some((item) => item.code === code)) throw new Error('终端编号已存在');
    const screen = {
      id: id('scr'), code, name: required(input.name, '终端名称'), site: required(input.site, '所属场所'),
      tags: Array.isArray(input.tags) ? input.tags : [], orientation: input.orientation || 'landscape',
      status: 'offline', lastHeartbeatAt: null, playerVersion: null,
      token: crypto.randomBytes(18).toString('base64url'), createdAt: now()
    };
    this.screens.set(screen.id, screen);
    this.#record(actor, 'SCREEN_ENROLLED', screen.id, { code });
    return structuredClone(screen);
  }

  /** 登记内容素材元数据并计算内容校验值。 */
  registerAsset(input, actor = 'editor') {
    const uri = required(input.uri, '素材地址');
    const checksum = input.checksum || crypto.createHash('sha256').update(uri).digest('hex');
    const asset = {
      id: id('ast'), name: required(input.name, '素材名称'), type: input.type || 'image', uri,
      durationSeconds: Math.max(1, Number(input.durationSeconds || 10)), checksum, status: 'ready', createdAt: now()
    };
    this.assets.set(asset.id, asset);
    this.#record(actor, 'ASSET_REGISTERED', asset.id, { checksum });
    return structuredClone(asset);
  }

  /** 创建有序播放单，校验全部素材存在。 */
  createPlaylist(input, actor = 'editor') {
    const assetIds = input.assetIds || [];
    if (!assetIds.length) throw new Error('播放单至少包含一个素材');
    assetIds.forEach((assetId) => { if (!this.assets.has(assetId)) throw new Error(`素材不存在: ${assetId}`); });
    const playlist = { id: id('pls'), name: required(input.name, '播放单名称'), assetIds, version: 1, createdAt: now() };
    this.playlists.set(playlist.id, playlist);
    this.#record(actor, 'PLAYLIST_CREATED', playlist.id, { assetCount: assetIds.length });
    return structuredClone(playlist);
  }

  /** 发布定时任务，支持终端、标签和幂等请求。 */
  publishCampaign(input, actor = 'publisher', idempotencyKey = '') {
    if (idempotencyKey && this.requests.has(idempotencyKey)) return structuredClone(this.campaigns.get(this.requests.get(idempotencyKey)));
    if (!this.playlists.has(input.playlistId)) throw new Error('播放单不存在');
    const targetScreenIds = input.targetScreenIds || [];
    const targetTags = input.targetTags || [];
    if (!targetScreenIds.length && !targetTags.length) throw new Error('至少选择终端或标签');
    targetScreenIds.forEach((screenId) => { if (!this.screens.has(screenId)) throw new Error(`终端不存在: ${screenId}`); });
    const startAt = input.startAt || now();
    const endAt = input.endAt || new Date(Date.now() + 7 * 86400000).toISOString();
    if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error('结束时间必须晚于开始时间');
    const campaign = {
      id: id('cmp'), name: required(input.name, '发布任务名称'), playlistId: input.playlistId,
      targetScreenIds, targetTags, startAt, endAt, priority: Number(input.priority || 50),
      revision: Date.now(), status: 'published', publishedAt: now()
    };
    this.campaigns.set(campaign.id, campaign);
    if (idempotencyKey) this.requests.set(idempotencyKey, campaign.id);
    this.#record(actor, 'CAMPAIGN_PUBLISHED', campaign.id, { targetScreenIds, targetTags });
    return structuredClone(campaign);
  }

  /** 接收播放器心跳并返回当前离线可用清单。 */
  heartbeat(screenId, input = {}) {
    const screen = this.screens.get(screenId);
    if (!screen) throw new Error('终端不存在');
    screen.status = input.health === 'fault' ? 'fault' : 'online';
    screen.playerVersion = input.playerVersion || screen.playerVersion || 'unknown';
    screen.storageFreeMb = Number(input.storageFreeMb || 0);
    screen.lastHeartbeatAt = now();
    return this.buildManifest(screenId);
  }

  /** 生成指定屏幕的签名播放清单，供断网缓存。 */
  buildManifest(screenId, at = new Date()) {
    const screen = this.screens.get(screenId);
    if (!screen) throw new Error('终端不存在');
    const timestamp = at.getTime();
    const campaigns = [...this.campaigns.values()].filter((campaign) =>
      campaign.status === 'published' && Date.parse(campaign.startAt) <= timestamp && Date.parse(campaign.endAt) >= timestamp &&
      (campaign.targetScreenIds.includes(screenId) || campaign.targetTags.some((tag) => screen.tags.includes(tag))))
      .sort((a, b) => b.priority - a.priority);
    const items = campaigns.flatMap((campaign) => {
      const playlist = this.playlists.get(campaign.playlistId);
      return playlist.assetIds.map((assetId, position) => ({ campaignId: campaign.id, position, ...this.assets.get(assetId) }));
    });
    const body = { screenId, revision: Math.max(0, ...campaigns.map((item) => item.revision)), generatedAt: now(), items };
    return { ...body, signature: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') };
  }

  /** 记录播放器播出证明，重复事件自动去重。 */
  reportProof(screenId, input) {
    if (!this.screens.has(screenId)) throw new Error('终端不存在');
    const eventId = required(input.eventId, '事件编号');
    const existing = this.proofs.find((item) => item.eventId === eventId);
    if (existing) return structuredClone(existing);
    const proof = { eventId, screenId, assetId: required(input.assetId, '素材编号'), campaignId: input.campaignId || null, playedAt: input.playedAt || now(), durationSeconds: Number(input.durationSeconds || 0) };
    this.proofs.push(proof);
    return structuredClone(proof);
  }

  /** 返回运营驾驶舱汇总。 */
  dashboard() {
    const screens = [...this.screens.values()];
    return {
      metrics: {
        screens: screens.length, online: screens.filter((item) => item.status === 'online').length,
        campaigns: this.campaigns.size, assets: this.assets.size, playsToday: this.proofs.length
      }, screens, campaigns: [...this.campaigns.values()], assets: [...this.assets.values()], audit: this.audit.slice(-20).reverse()
    };
  }

  /** 导出可持久化快照。 */
  dump() {
    return {
      screens: [...this.screens.values()], assets: [...this.assets.values()], playlists: [...this.playlists.values()],
      campaigns: [...this.campaigns.values()], proofs: this.proofs, audit: this.audit, requests: [...this.requests.entries()]
    };
  }

  #record(actor, action, resourceId, detail) {
    this.audit.push({ id: id('aud'), actor, action, resourceId, detail, occurredAt: now() });
  }
}

/** 创建可展示完整业务链路的演示数据。 */
export function createDemoService() {
  const service = new SignageService();
  const lobby = service.enrollScreen({ code: 'SH-LB-01', name: '上海总部大堂屏', site: '上海总部', tags: ['hq', 'lobby'] });
  const canteen = service.enrollScreen({ code: 'SH-CT-02', name: '员工餐厅横屏', site: '上海总部', tags: ['hq', 'canteen'] });
  const news = service.registerAsset({ name: '企业资讯晨报', type: 'html', uri: '/demo/news', durationSeconds: 18 });
  const safety = service.registerAsset({ name: '园区安全提醒', type: 'image', uri: '/demo/safety.jpg', durationSeconds: 12 });
  const playlist = service.createPlaylist({ name: '总部日常信息流', assetIds: [news.id, safety.id] });
  service.publishCampaign({ name: '总部公共信息发布', playlistId: playlist.id, targetTags: ['hq'] });
  service.heartbeat(lobby.id, { playerVersion: '1.0.0', storageFreeMb: 8192 });
  service.heartbeat(canteen.id, { playerVersion: '1.0.0', storageFreeMb: 6144 });
  service.reportProof(lobby.id, { eventId: 'demo-play-001', assetId: news.id, durationSeconds: 18 });
  return service;
}
