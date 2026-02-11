# Chat 未读与最近消息规则（V1）

**Date:** February 11, 2026  
**Scope:** 聊天未读计数、最近消息预览（chat preview strip）  
**Status:** Implemented + E2E covered

---

## 1. 目标

统一聊天的“未读状态”与“最近消息预览”行为，避免以下问题：

- 自己发送的消息被当成“最近消息”
- 用户已进入聊天或主动关闭预览后，界面仍显示“最近消息”

---

## 2. 产品规则（必须满足）

### R1. 自己发送的消息不算未读

- 当前玩家自己发送消息时：
  - `chatUnreadCount` 不增加
  - 不触发最近消息预览

### R2. 最近消息预览只显示“未读且来自他人”的最新一条

- 预览消息来源不是“聊天总消息最后一条”，而是：
  - 倒序查找最近一条 `sender.playerId !== 当前玩家ID` 的消息
  - 且仅在 `chatUnreadCount > 0` 时显示

### R3. 打开聊天面板等价于“清未读”

- 当聊天面板打开（`setChatPanelOpen(true)`）时：
  - `chatUnreadCount` 立即归零
  - 最近消息预览应自动消失

### R4. 关闭最近消息预览等价于“清未读”

- 用户点击预览上的关闭按钮（`×`）时：
  - 当前预览隐藏
  - `chatUnreadCount` 归零
  - 关闭后不应立即重复出现同一条预览

---

## 3. 验收标准

### A1. 自发消息

- 玩家 A 自己发送文本/语音消息后：
  - 未读仍为 0
  - 不出现最近消息预览

### A2. 他人新消息 + 关闭预览

- 玩家 B 收到玩家 A 的新消息：
  - 未读变为 1
  - 显示最近消息预览
- 玩家 B 点击关闭预览：
  - 未读回到 0
  - 预览消失

### A3. 他人新消息 + 打开聊天

- 玩家 B 再收到玩家 A 的新消息后：
  - 未读变为 1，预览出现
- 玩家 B 打开聊天面板：
  - 未读回到 0
  - 关闭聊天后预览不应继续显示

---

## 4. 实现落点（代码）

- 未读状态管理：
  - `/Users/kai/.codex/worktrees/16e7/Poker/poker-client/src/contexts/GameContext.tsx`
- 最近消息预览选择与关闭行为：
  - `/Users/kai/.codex/worktrees/16e7/Poker/poker-client/src/components/GameRoom.tsx`
- 回归测试：
  - `/Users/kai/.codex/worktrees/16e7/Poker/poker-server/test/e2e/comprehensive-poker.spec.ts`

---

## 5. 当前结论

本规则已落地，并通过针对性 E2E 回归覆盖：

- 自发消息不出预览
- 打开聊天清未读并清预览
- 关闭预览清未读并清预览
