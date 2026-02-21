# Deferred 规格：Passkey 删除与找回（下个迭代）

**Date:** February 21, 2026  
**Scope:** Passkey 删除与找回策略（延后实现）  
**Status:** Planned (Deferred from PR #54)

---

## 摘要

本次 PR（#54）不实现 Passkey 删除能力，只保留当前登录/注册与设置能力。  
将“删除 Passkey + 找回策略”作为下个迭代的明确范围，避免当前 PR 继续膨胀和反复评论。

---

## 文档落点

新增文档文件（下次执行时落库）：
- `docs/plans/2026-02-21-passkey-delete-recovery-deferred.md`

---

## 文档正文（决策已锁定）

### 1. Status

- `Planned (Deferred from PR #54)`

### 2. 已确认产品决策

- 删除策略：安全锁定（不允许删到 0 个登录方式）
- 前置条件：先新增另一个 Passkey 才允许删除
- 找回策略：MVP 不做在线找回（无恢复码/无邮箱）
- 删除粒度：列表逐个删除
- 列表展示：创建时间 + 短 credentialId
- 删除确认：弹窗确认即可
- 删除后会话：全设备强制下线
- 入口位置：设置页 + 牌桌设置弹窗

### 3. 下次实现范围（In Scope）

- 列出当前账号 Passkey 列表
- 给当前账号新增 Passkey
- 删除指定 Passkey（禁止删除最后一个）
- 删除后失效该账号所有会话并跳转登录页
- 中英文文案与交互提示完善

### 4. 非范围（Out of Scope）

- 恢复码/邮箱找回/人工找回
- Passkey 重命名
- 设备品牌识别

### 5. 接口草案（下次实现）

- `GET /api/auth/me/passkeys`
- `POST /api/auth/me/passkeys/start`
- `POST /api/auth/me/passkeys/finish`
- `DELETE /api/auth/me/passkeys/:credentialId`

### 6. 验收标准

- 仅剩 1 个 Passkey 时删除被阻止并提示
- 新增第二个 Passkey后可删除其中一个
- 删除成功后当前与其他设备会话失效
- 能用剩余 Passkey重新登录
- 设置页和牌桌设置弹窗行为一致

---

## 对当前 PR 的影响

- 当前 PR 不新增删除逻辑、不新增删除 API，保持可控范围。
- 后续以独立 PR 实现，减少对现有认证主线的回归风险。

---

## 假设与默认值

- 账号恢复由“用户自行保留至少一个可用 Passkey”承担。
- 若用户丢失所有 Passkey，MVP 只能新注册账号。
