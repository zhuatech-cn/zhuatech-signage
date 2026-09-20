# API 摘要

管理接口使用 `x-api-key`，播放器接口可使用 `x-device-token`。错误统一返回 `{error,message}`。

- `GET /api/dashboard`：运营汇总
- `POST /api/screens`：注册终端
- `POST /api/assets`：登记素材
- `POST /api/playlists`：创建播放单
- `POST /api/campaigns`：发布任务，支持 `Idempotency-Key`
- `POST /api/screens/{id}/heartbeat`：播放器心跳并获取清单
- `GET /api/screens/{id}/manifest`：签名播放清单
- `POST /api/screens/{id}/proofs`：播出证明
