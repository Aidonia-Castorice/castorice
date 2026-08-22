<template>
  <div class="bot-management">
    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon bot-icon">
          <SvgIcon name="user" width="22" height="22" />
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.bot_count }}</span>
          <span class="stat-label">API 账号</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon post-icon">
          <SvgIcon name="post" width="22" height="22" />
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.post_count }}</span>
          <span class="stat-label">帖子总数</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon image-icon">
          <SvgIcon name="collect" width="22" height="22" />
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.image_count }}</span>
          <span class="stat-label">图片总数</span>
        </div>
      </div>
      <div class="stat-card action-card" @click="showGenerateDialog = true">
        <div class="stat-icon generate-icon">
          <SvgIcon name="data" width="22" height="22" />
        </div>
        <div class="stat-info">
          <span class="stat-value action-text">生成帖子</span>
          <span class="stat-label">从图库 API 拉取图片</span>
        </div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="toolbar">
      <h2 class="section-title">API 虚拟账号</h2>
      <button class="btn btn-primary" @click="openCreateDialog">
        <SvgIcon name="follow" width="16" height="16" />
        <span>添加账号</span>
      </button>
    </div>

    <!-- 账号列表 -->
    <div class="bot-list" v-loading="loading">
      <div v-if="botUsers.length === 0 && !loading" class="empty-state">
        <SvgIcon name="user" width="48" height="48" />
        <p>暂无 API 账号，点击「添加账号」创建</p>
      </div>
      <div v-for="bot in botUsers" :key="bot.id" class="bot-card">
        <div class="bot-avatar-wrapper">
          <img :src="bot.avatar || '/default-avatar.png'" :alt="bot.nickname" class="bot-avatar"
            @error="handleAvatarError" />
        </div>
        <div class="bot-info">
          <div class="bot-name-row">
            <span class="bot-nickname">{{ bot.nickname }}</span>
            <span class="bot-post-count">{{ bot.post_count || 0 }} 篇帖子</span>
          </div>
          <p class="bot-bio">{{ bot.bio || '这个人很懒，什么都没写~' }}</p>
          <div class="bot-meta">
            <span v-if="bot.location" class="bot-location">
              <SvgIcon name="category" width="12" height="12" />
              {{ bot.location }}
            </span>
            <span class="bot-status" :class="{ inactive: !bot.is_active }">
              {{ bot.is_active ? '正常' : '已停用' }}
            </span>
          </div>
        </div>
        <div class="bot-actions">
          <button class="btn-icon" title="编辑" @click="openEditDialog(bot)">
            <SvgIcon name="setting" width="18" height="18" />
          </button>
          <button class="btn-icon btn-danger" title="删除" @click="confirmDelete(bot)">
            <SvgIcon name="close" width="18" height="18" />
          </button>
        </div>
      </div>
    </div>

    <!-- 创建/编辑弹窗 -->
    <div v-if="showDialog" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog">
        <div class="dialog-header">
          <h3>{{ editingBot ? '编辑 API 账号' : '添加 API 账号' }}</h3>
          <button class="dialog-close" @click="closeDialog">
            <SvgIcon name="close" width="20" height="20" />
          </button>
        </div>
        <div class="dialog-body">
          <!-- 头像预览和选择 -->
          <div class="avatar-section">
            <div class="avatar-preview">
              <img :src="form.avatar || '/default-avatar.png'" alt="头像预览" @error="handleAvatarError" />
            </div>
            <div class="avatar-presets">
              <p class="preset-label">选择预设头像：</p>
              <div class="preset-list">
                <div v-for="preset in presetAvatars" :key="preset" class="preset-item"
                  :class="{ active: form.avatar === preset }" @click="form.avatar = preset">
                  <img :src="preset" alt="预设头像" @error="handleAvatarError" />
                </div>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>头像 URL</label>
            <input v-model="form.avatar" type="text" placeholder="输入图片链接，或选择上方预设头像" />
          </div>
          <div class="form-group">
            <label>昵称 <span class="required">*</span></label>
            <input v-model="form.nickname" type="text" placeholder="请输入昵称" maxlength="20" />
          </div>
          <div class="form-group">
            <label>个性签名</label>
            <textarea v-model="form.bio" placeholder="写点什么介绍一下这个账号吧" maxlength="100" rows="2"></textarea>
          </div>
          <div class="form-group">
            <label>所在地</label>
            <input v-model="form.location" type="text" placeholder="如：杭州" maxlength="20" />
          </div>
          <div class="form-group" v-if="editingBot">
            <label>状态</label>
            <div class="switch-row">
              <label class="switch">
                <input type="checkbox" v-model="form.is_active" />
                <span class="slider"></span>
              </label>
              <span>{{ form.is_active ? '正常' : '停用' }}</span>
            </div>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn btn-default" @click="closeDialog">取消</button>
          <button class="btn btn-primary" @click="saveBot" :disabled="saving">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 生成帖子弹窗 -->
    <div v-if="showGenerateDialog" class="dialog-overlay" @click.self="showGenerateDialog = false">
      <div class="dialog">
        <div class="dialog-header">
          <h3>从图库 API 生成帖子</h3>
          <button class="dialog-close" @click="showGenerateDialog = false">
            <SvgIcon name="close" width="20" height="20" />
          </button>
        </div>
        <div class="dialog-body">
          <p class="generate-desc">
            将从图库 API 随机获取图片，自动分配给 API 账号发布帖子。每篇帖子包含 1~5 张图片，帖子数量由返回的图片数量决定。
          </p>
          <div class="form-group">
            <label>目标图片数量（30~300）</label>
            <input v-model.number="generateCount" type="number" min="30" max="300" placeholder="120" />
            <p class="form-hint">预计生成约 {{ Math.round(generateCount / 3) }} 篇帖子（每篇平均 3 张图）</p>
          </div>
          <div v-if="generateResult" class="generate-result">
            <SvgIcon name="verified" width="20" height="20" />
            <span>{{ generateResult }}</span>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn btn-default" @click="showGenerateDialog = false">关闭</button>
          <button class="btn btn-primary" @click="generatePosts" :disabled="generating">
            {{ generating ? '生成中，请稍候...' : '开始生成' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import request from '@/api/request.js'

const loading = ref(false)
const saving = ref(false)
const generating = ref(false)
const botUsers = ref([])
const stats = reactive({ bot_count: 0, post_count: 0, image_count: 0 })
const showDialog = ref(false)
const showGenerateDialog = ref(false)
const editingBot = ref(null)
const generateCount = ref(120)
const generateResult = ref('')

const presetAvatars = [
  '/default-avatar.png',
  '/default-avatar.png',
  '/bot-avatars/fufu_avatar_2.jpg',
  '/bot-avatars/fufu_avatar_3.jpg',
  '/bot-avatars/fufu_avatar_4.jpg',
  '/bot-avatars/fufu_avatar_5.jpg'
]

const form = reactive({
  nickname: '',
  bio: '',
  location: '',
  avatar: '',
  is_active: true
})

function resetForm() {
  form.nickname = ''
  form.bio = ''
  form.location = ''
  form.avatar = ''
  form.is_active = true
  editingBot.value = null
}

function openCreateDialog() {
  resetForm()
  showDialog.value = true
}

function openEditDialog(bot) {
  resetForm()
  editingBot.value = bot
  form.nickname = bot.nickname
  form.bio = bot.bio || ''
  form.location = bot.location || ''
  form.avatar = bot.avatar || ''
  form.is_active = !!bot.is_active
  showDialog.value = true
}

function closeDialog() {
  showDialog.value = false
  resetForm()
}

function handleAvatarError(e) {
  e.target.src = '/default-avatar.png'
}

async function loadData() {
  loading.value = true
  try {
    const [botsRes, statsRes] = await Promise.all([
      request.get('/admin/bot-users'),
      request.get('/admin/bot-stats')
    ])
    if (botsRes.success) botUsers.value = botsRes.data || []
    if (statsRes.success) Object.assign(stats, statsRes.data)
  } catch (err) {
    console.error('加载数据失败:', err)
  } finally {
    loading.value = false
  }
}

async function saveBot() {
  if (!form.nickname.trim()) {
    alert('请输入昵称')
    return
  }
  saving.value = true
  try {
    const payload = {
      nickname: form.nickname.trim(),
      bio: form.bio.trim(),
      location: form.location.trim(),
      avatar: form.avatar.trim()
    }
    let res
    if (editingBot.value) {
      payload.is_active = form.is_active
      res = await request.put(`/admin/bot-users/${editingBot.value.id}`, payload)
    } else {
      res = await request.post('/admin/bot-users', payload)
    }
    if (res.success) {
      closeDialog()
      await loadData()
    } else {
      alert(res.message || '保存失败')
    }
  } catch (err) {
    alert('保存失败: ' + (err.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(bot) {
  if (!confirm(`确定删除 API 账号「${bot.nickname}」吗？该账号的所有帖子也会被删除，此操作不可恢复。`)) return
  try {
    const res = await request.delete(`/admin/bot-users/${bot.id}`)
    if (res.success) {
      await loadData()
    } else {
      alert(res.message || '删除失败')
    }
  } catch (err) {
    alert('删除失败: ' + (err.message || '未知错误'))
  }
}

async function generatePosts() {
  if (generateCount.value < 30 || generateCount.value > 300) {
    alert('图片数量请在 30~300 之间')
    return
  }
  generating.value = true
  generateResult.value = ''
  try {
    const res = await request.post('/admin/bot-users/generate-posts', { count: generateCount.value })
    if (res.success) {
      generateResult.value = res.message || '生成成功'
      await loadData()
    } else {
      alert(res.message || '生成失败')
    }
  } catch (err) {
    alert('生成失败: ' + (err.message || '未知错误'))
  } finally {
    generating.value = false
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.bot-management {
  padding: 0;
}

/* 统计卡片 */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  background: var(--bg-card, #fff);
  border-radius: 12px;
  border: 1px solid var(--border-color, #eee);
  transition: box-shadow 0.2s;
}

.stat-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.action-card {
  cursor: pointer;
  border-style: dashed;
}

.action-card:hover {
  border-color: var(--primary-color, #ff2442);
}

.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}

.bot-icon { background: linear-gradient(135deg, #667eea, #764ba2); }
.post-icon { background: linear-gradient(135deg, #f093fb, #f5576c); }
.image-icon { background: linear-gradient(135deg, #4facfe, #00f2fe); }
.generate-icon { background: linear-gradient(135deg, #43e97b, #38f9d7); }

.stat-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary, #333);
}

.stat-label {
  font-size: 13px;
  color: var(--text-secondary, #999);
}

.action-text {
  font-size: 16px;
  color: var(--primary-color, #ff2442);
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}

/* 按钮 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--primary-color, #ff2442);
  color: #fff;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-default {
  background: var(--bg-hover, #f5f5f5);
  color: var(--text-primary, #333);
}

.btn-default:hover {
  background: var(--bg-active, #eee);
}

/* 账号列表 */
.bot-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary, #999);
}

.empty-state p {
  margin-top: 12px;
}

.bot-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: var(--bg-card, #fff);
  border-radius: 12px;
  border: 1px solid var(--border-color, #eee);
  transition: box-shadow 0.2s;
}

.bot-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.bot-avatar-wrapper {
  flex-shrink: 0;
}

.bot-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--border-color, #f0f0f0);
}

.bot-info {
  flex: 1;
  min-width: 0;
}

.bot-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.bot-nickname {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.bot-post-count {
  font-size: 12px;
  color: var(--text-secondary, #999);
  background: var(--bg-hover, #f5f5f5);
  padding: 2px 8px;
  border-radius: 10px;
}

.bot-bio {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0 0 6px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bot-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.bot-location {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.bot-status {
  color: #67c23a;
}

.bot-status.inactive {
  color: #f56c6c;
}

.bot-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.btn-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #eee);
  background: var(--bg-card, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
  transition: all 0.2s;
}

.btn-icon:hover {
  border-color: var(--primary-color, #ff2442);
  color: var(--primary-color, #ff2442);
}

.btn-icon.btn-danger:hover {
  border-color: #f56c6c;
  color: #f56c6c;
}

/* 弹窗 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.dialog {
  background: var(--bg-card, #fff);
  border-radius: 14px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.15);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border-color, #eee);
}

.dialog-header h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.dialog-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary, #999);
  padding: 4px;
  display: flex;
}

.dialog-close:hover {
  color: var(--text-primary, #333);
}

.dialog-body {
  padding: 20px 24px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color, #eee);
}

/* 表单 */
.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--text-primary, #333);
}

.required {
  color: #f56c6c;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group textarea {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-input, #fff);
  color: var(--text-primary, #333);
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s;
}

.form-group input:focus,
.form-group textarea:focus {
  border-color: var(--primary-color, #ff2442);
}

.form-group textarea {
  resize: vertical;
  font-family: inherit;
}

.form-hint {
  font-size: 12px;
  color: var(--text-secondary, #999);
  margin: 4px 0 0;
}

/* 头像选择 */
.avatar-section {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.avatar-preview {
  flex-shrink: 0;
}

.avatar-preview img {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--border-color, #f0f0f0);
}

.avatar-presets {
  flex: 1;
}

.preset-label {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0 0 8px;
}

.preset-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.preset-item {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.2s;
}

.preset-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preset-item.active {
  border-color: var(--primary-color, #ff2442);
}

/* 开关 */
.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #ccc;
  border-radius: 24px;
  transition: 0.3s;
}

.slider:before {
  content: "";
  position: absolute;
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background: #fff;
  border-radius: 50%;
  transition: 0.3s;
}

.switch input:checked + .slider {
  background: var(--primary-color, #ff2442);
}

.switch input:checked + .slider:before {
  transform: translateX(20px);
}

/* 生成帖子 */
.generate-desc {
  font-size: 14px;
  color: var(--text-secondary, #666);
  line-height: 1.6;
  margin: 0 0 16px;
}

.generate-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #f0f9eb;
  border-radius: 8px;
  color: #67c23a;
  font-size: 14px;
}

/* 响应式 */
@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .bot-card {
    flex-wrap: wrap;
  }
  .bot-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
