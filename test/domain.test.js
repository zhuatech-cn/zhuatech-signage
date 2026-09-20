import test from 'node:test';
import assert from 'node:assert/strict';
import { SignageService } from '../src/domain.js';

test('发布任务后终端可以取得签名播放清单', () => {
  const service = new SignageService();
  const screen = service.enrollScreen({ code: 'S-01', name: '一号屏', site: '总部', tags: ['hq'] });
  const asset = service.registerAsset({ name: '通知', uri: '/notice.png' });
  const playlist = service.createPlaylist({ name: '通知播放单', assetIds: [asset.id] });
  service.publishCampaign({ name: '总部发布', playlistId: playlist.id, targetTags: ['hq'] });
  const manifest = service.heartbeat(screen.id, { playerVersion: '1.0.0', storageFreeMb: 1024 });
  assert.equal(manifest.items.length, 1);
  assert.equal(manifest.items[0].id, asset.id);
  assert.equal(manifest.signature.length, 64);
});

test('发布请求幂等且播出证明去重', () => {
  const service = new SignageService();
  const screen = service.enrollScreen({ code: 'S-02', name: '二号屏', site: '门店' });
  const asset = service.registerAsset({ name: '海报', uri: '/poster.png' });
  const playlist = service.createPlaylist({ name: '海报单', assetIds: [asset.id] });
  const input = { name: '门店发布', playlistId: playlist.id, targetScreenIds: [screen.id] };
  assert.equal(service.publishCampaign(input, 'admin', 'req-1').id, service.publishCampaign(input, 'admin', 'req-1').id);
  service.reportProof(screen.id, { eventId: 'evt-1', assetId: asset.id });
  service.reportProof(screen.id, { eventId: 'evt-1', assetId: asset.id });
  assert.equal(service.dump().proofs.length, 1);
});

test('拒绝空播放单和无目标发布', () => {
  const service = new SignageService();
  assert.throws(() => service.createPlaylist({ name: '空', assetIds: [] }), /至少包含/);
});
